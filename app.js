/* ===========================
   Utils
=========================== */
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const num = (v, fallback=0) => {
  if (v === null || v === undefined) return fallback;
  if (typeof v === "string") {
    v = v.trim().replace(/\s+/g, "");
    v = v.replace(",", ".");
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const eur = (n) => new Intl.NumberFormat('it-IT', { style:'currency', currency:'EUR' }).format(round2(n));
const uid = () => Math.random().toString(36).slice(2, 10);
const escapeHtml = (s) => String(s ?? "")
  .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
  .replaceAll('"',"&quot;").replaceAll("'","&#039;");

const fmtComma = (v) => String(v).replace(".", ",");

const nowStr = () => {
  const d = new Date();
  const pad = (n)=> String(n).padStart(2,"0");
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/* ===========================
   SUPABASE & AUTH
=========================== */
const SUPABASE_URL = "https://lfyyrhofxxfggsiwotgd.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_IQH251PhBPuPOlA3LcWakg_EOahojfN";

let currentUser = null;
let supabaseClient = null;
let authListenerSetup = false;
let dataLoadedOnce = false;

function getAuthSupabaseClient() {
  if (!supabaseClient && window.supabase) {
    console.log("🔵 Creating NEW auth Supabase client");
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return supabaseClient;
}

// Funzione per aspettare che Supabase sia disponibile
function waitForSupabase(maxAttempts = 50) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      attempts++;
      if (window.supabase) {
        console.log("✅ Supabase SDK caricato dopo", attempts, "tentativi");
        resolve(true);
      } else if (attempts >= maxAttempts) {
        console.error("❌ Supabase SDK non caricato dopo", maxAttempts, "tentativi");
        reject(new Error("Supabase SDK non disponibile"));
      } else {
        setTimeout(check, 100);
      }
    };
    check();
  });
}

async function initSupabase() {
  console.log("🟢 initSupabase called");
  
  // IMPORTANTE: imposta sempre l'utente attivo (offline o online)
  handleUserChange(null);
  
  // Aspetta che Supabase sia disponibile
  try {
    await waitForSupabase();
  } catch (err) {
    console.error("❌ Impossibile caricare Supabase:", err);
    console.warn("⚠️ Modalità offline - usiamo solo localStorage");
    // Continua comunque in modalità offline
    currentUser = null;
    showMainApp(); // Mostra app anche senza auth
    console.log("✅ App avviata in modalità OFFLINE");
    return;
  }
  
  const sb = getAuthSupabaseClient();
  if (!sb) {
    console.error("Supabase non caricato");
    console.warn("⚠️ Modalità offline");
    showMainApp(); // Mostra app comunque
    return;
  }
  
  try {
    // Check if user is already logged in
    const { data: { user } } = await sb.auth.getUser();
    console.log("🟣 Current user from Supabase:", user?.id || "NO USER");
    
    if (user) {
      handleUserChange(user);
      currentUser = user;
      await ensureUserProfile(sb, user);
      await showMainApp();
      console.log("✅ User logged in, showing main app");
    } else {
      currentUser = null;
      handleUserChange(null);
      showAuthScreen();
      console.log("✅ No user, showing auth screen");
    }
    
    // Listen for auth changes - SOLO UNA VOLTA
    if (!authListenerSetup) {
      console.log("🟡 Setting up auth listener");
      authListenerSetup = true;
      sb.auth.onAuthStateChange(async (event, session) => {
        console.log("🔴 Auth state changed:", event, "Session:", session?.user?.id || "NO SESSION");
        if (session?.user) {
          console.log("🟢 User session active");
          handleUserChange(session.user);
          currentUser = session.user;
          await ensureUserProfile(sb, session.user);
          await showMainApp();
        } else {
          console.log("🔴 User session ended");
          currentUser = null;
          handleUserChange(null);
          showAuthScreen();
        }
      });
      
      // Sincronizza stato quando la pagina torna in focus
      document.addEventListener("visibilitychange", async () => {
        if (document.visibilityState === "visible") {
          console.log("📱 Page became visible, syncing auth state...");
          const { data: { user } } = await sb.auth.getUser();
          
          // Se lo stato è cambiato, aggiorna
          if (user && !currentUser) {
            console.log("✅ User logged in from another tab");
            handleUserChange(user);
            currentUser = user;
            await ensureUserProfile(sb, user);
            await showMainApp();
          } else if (!user && currentUser) {
            console.log("✅ User logged out from another tab");
            currentUser = null;
            handleUserChange(null);
            showAuthScreen();
          }
        }
      });
    }
  } catch(err) {
    console.error("❌ Errore in initSupabase:", err);
  }
}

async function ensureUserProfile(sb, user) {
  // Usa upsert per inserire solo se non esiste, senza update
  const now = new Date().toISOString();
  
  const { error: upsertError } = await sb
    .from("user_profiles")
    .upsert({
      id: user.id,
      email: user.email,
      company: user.user_metadata?.company || "N/A",
      created_at: now
    }, {
      onConflict: 'id',
      ignoreDuplicates: true  // NON aggiornare se esiste già!
    });
  
  if (upsertError) {
    console.error("Error ensuring profile:", upsertError);
  }
}

function showAuthScreen() {
  console.log("🟠 showAuthScreen called");
  $("view-auth").style.display = "flex";
  $("view-main-app").style.display = "none";
  dataLoadedOnce = false; // Reset quando si fa logout
}

async function showMainApp() {
  console.log("🟣 showMainApp called, dataLoadedOnce:", dataLoadedOnce);
  $("view-auth").style.display = "none";
  $("view-main-app").style.display = "flex";
  $("view-main-app").style.flexDirection = "column";
  
  // Carica SEMPRE da localStorage prima di tutto
  console.log("📂 Caricamento da localStorage...");
  const savedLibrary = loadLibrary();
  const savedItems = loadItemLibrary();
  
  if(savedLibrary && savedLibrary.length > 0) {
    library = savedLibrary;
    console.log("✅ Libreria caricata da localStorage:", library.length, "preventivi");
  }
  
  if(savedItems && savedItems.length > 0) {
    itemLibrary = savedItems;
    renderItemLibrary();
    console.log("✅ Articoli caricati da localStorage:", itemLibrary.length, "articoli");
  }
  
  // Load user's quotes and items from Supabase - SOLO LA PRIMA VOLTA e solo se autenticati
  if (currentUser && !dataLoadedOnce) {
    dataLoadedOnce = true;
    console.log("Loading data from Supabase for the first time...");
    
    // Funzione helper per caricare con retry
    const loadWithRetry = async (loadFn, name, maxRetries = 3) => {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(`📥 Caricamento ${name} (tentativo ${attempt}/${maxRetries})...`);
          const result = await loadFn();
          if (result && Array.isArray(result)) {
            console.log(`✅ ${name} caricati: ${result.length} elementi`);
            return result;
          }
          console.warn(`⚠️ ${name} ritornato valore non valido, retry...`);
        } catch (err) {
          console.error(`❌ Errore caricamento ${name} (tentativo ${attempt}):`, err);
        }
        // Aspetta prima di riprovare (backoff esponenziale)
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 500 * attempt));
        }
      }
      console.error(`❌ Impossibile caricare ${name} dopo ${maxRetries} tentativi`);
      return [];
    };
    
    // Load quotes and items in parallel with retry
    try {
      const [quotes, items] = await Promise.all([
        loadWithRetry(supabaseLoadQuotes, "preventivi"),
        loadWithRetry(supabaseLoadItems, "articoli")
      ]);
      
      console.log("Data loaded:", quotes?.length || 0, "quotes,", items?.length || 0, "items");
      
      // Sovrascrivi solo se Supabase ha dati più recenti
      if (quotes && quotes.length > 0) {
        library = quotes;
        saveLibrary(library);
        renderLibrary();
      }
      
      if (items && items.length > 0) {
        itemLibrary = items;
        saveItemLibrary(itemLibrary);
        renderItemLibrary();
      }
    } catch (err) {
      console.error("Error loading data:", err);
      // Reset flag per permettere un nuovo tentativo
      dataLoadedOnce = false;
    }
  }
}

async function authSignUp() {
  const sb = getAuthSupabaseClient();
  const email = $("regEmail").value.trim();
  const password = $("regPassword").value;
  const password2 = $("regPassword2").value;
  const company = $("regCompany").value.trim();
  
  if (!email || !password) {
    showAuthError("Email e password sono obbligatori");
    return;
  }
  
  // Validazione formato email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    showAuthError("Email non valida. Controlla il formato (es: nome@dominio.com)");
    return;
  }
  
  if (password !== password2) {
    showAuthError("Le password non corrispondono");
    return;
  }
  
  if (password.length < 6) {
    showAuthError("La password deve avere almeno 6 caratteri");
    return;
  }
  
  try {
    console.log("SignUp attempt:", { email, company });
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: {
        data: {
          company: company || "N/A"
        }
      }
    });
    
    console.log("SignUp response:", { data, error });
    
    if (error) {
      console.error("SignUp error:", error);
      showAuthError("Errore: " + error.message);
      return;
    }
    
    // Create user profile
    if (data.user) {
      console.log("Creating user profile for:", data.user.id);
      const { error: profileError } = await sb.from("user_profiles").insert({
        id: data.user.id,
        email: email,
        first_name: company || "N/A",
        last_name: "",
        company_name: company || "N/A"
      });
      
      if (profileError) {
        console.error("Profile creation error:", profileError);
      }
      
      showAuthMessage("✅ Account creato! Controlla la tua email per confermare l'indirizzo (anche in Spam). Dopo la conferma potrai accedere.", "success", { showRefresh: true });
      // Lascia il messaggio visibile finché l'utente non decide
    }
  } catch (err) {
    console.error("SignUp exception:", err);
    showAuthError("Errore: " + err.message);
  }
}

async function authLogin() {
  const sb = getAuthSupabaseClient();
  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;
  
  if (!email || !password) {
    showAuthError("Email e password sono obbligatori");
    return;
  }
  
  // Validazione formato email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    showAuthError("Email non valida. Controlla il formato (es: nome@dominio.com)");
    return;
  }
  
  try {
    const { data, error } = await sb.auth.signInWithPassword({
      email,
      password
    });
    
    if (error) {
      showAuthError(error.message);
      return;
    }
    
    // Clear error and show app
    clearAuthError();
    currentUser = data.user;
    await showMainApp();
  } catch (err) {
    showAuthError(err.message);
  }
}

async function authLoginGoogle() {
  const sb = getAuthSupabaseClient();
  try {
    const { data, error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin,
        queryParams: {
          prompt: "select_account"
        }
      }
    });
    
    if (error) {
      showAuthError(error.message);
    }
  } catch (err) {
    showAuthError(err.message);
  }
}

async function authLogout() {
  console.log("🔴 Logout clicked!");
  const sb = getAuthSupabaseClient();
  try {
    console.log("🟡 Calling signOut...");
    const { error } = await sb.auth.signOut({ scope: 'local' });
    
    if (error) {
      console.error("🔴 SignOut error:", error);
      showAuthError("Errore nel logout: " + error.message);
      return;
    }
    
    console.log("🟢 SignOut successful");
    
    // Verifica che la sessione sia veramente terminata
    await new Promise(resolve => setTimeout(resolve, 150));
    
    const { data: { user } } = await sb.auth.getUser();
    console.log("🟣 Verified user state after logout:", user ? "STILL LOGGED IN" : "LOGGED OUT");
    
    // Clear all localStorage to ensure clean state
    try {
      const allKeys = Object.keys(localStorage);
      for (let key of allKeys) {
        if (key.includes('STORAGE_') || key.includes('::') || key === 'activeUserId') {
          localStorage.removeItem(key);
          console.log("🟠 Cleared localStorage key:", key);
        }
      }
    } catch (e) {
      console.warn("Could not clear localStorage:", e);
    }
    
    // Forza lo stato di logout immediatamente
    currentUser = null;
    activeUserId = "anon";
    clearAuthError();
    clearAuthForms();
    handleUserChange(null);
    dataLoadedOnce = false;
    console.log("🟢 Showing auth screen...");
    showAuthScreen();
    
    // Fallback: se il listener non triggera entro 500ms, ridisegna l'UI
    setTimeout(() => {
      if (currentUser === null) {
        console.log("🟠 Fallback: ensuring auth screen is visible");
        $("view-auth").style.display = "flex";
        $("view-main-app").style.display = "none";
      }
    }, 500);
    
  } catch (err) {
    console.error("Logout exception:", err);
    showAuthError("Errore nel logout: " + err.message);
  }
}

function showAuthMessage(message, type = "error", opts = {}) {
  const errorEl = $("authError");
  const showRefresh = !!opts.showRefresh;
  errorEl.classList.toggle("success", type === "success");
  if (showRefresh) {
    errorEl.innerHTML = `
      <div>${escapeHtml(message)}</div>
      <button type="button" class="primary" id="authRefreshBtn">Ho confermato, ricarica</button>
    `;
    const btn = $("authRefreshBtn");
    if (btn) btn.onclick = () => window.location.reload();
  } else {
    errorEl.textContent = message;
  }
  errorEl.style.display = "block";
}

function showAuthError(message) {
  showAuthMessage(message, "error");
}

function clearAuthError() {
  const errorEl = $("authError");
  errorEl.textContent = "";
  errorEl.classList.remove("success");
  errorEl.style.display = "none";
}

function toggleAuthForms() {
  const loginForm = $("authLoginForm");
  const regForm = $("authRegisterForm");
  loginForm.style.display = loginForm.style.display === "none" ? "block" : "none";
  regForm.style.display = regForm.style.display === "none" ? "block" : "none";
  clearAuthError();
}

function clearAuthForms() {
  $("authEmail").value = "";
  $("authPassword").value = "";
  $("regEmail").value = "";
  $("regPassword").value = "";
  $("regPassword2").value = "";
  $("regCompany").value = "";
}

async function loadUserProfile() {
  console.log("=== loadUserProfile START ===");
  console.log("currentUser:", currentUser);
  
  if (!currentUser) {
    console.log("No current user, returning");
    return;
  }
  
  console.log("Loading user profile:", currentUser);
  
  const sb = getAuthSupabaseClient();
  console.log("Supabase client:", sb);
  
  // Set name (from Google OAuth metadata or email)
  const userName = currentUser.user_metadata?.full_name || 
                   currentUser.user_metadata?.name || 
                   currentUser.email?.split('@')[0] || 
                   "Utente";
  console.log("User name:", userName);
  
  const userNameEl = $("userName");
  console.log("userName element:", userNameEl);
  if (userNameEl) {
    userNameEl.value = userName;
    console.log("Set userName to:", userName);
  }
  
  // Set email (readonly)
  const userEmailEl = $("userEmail");
  console.log("userEmail element:", userEmailEl);
  if (userEmailEl) {
    userEmailEl.value = currentUser.email || "";
    console.log("Set userEmail to:", currentUser.email);
  }
  
  // Set created date
  const userCreatedAtEl = $("userCreatedAt");
  console.log("userCreatedAt element:", userCreatedAtEl);
  if (currentUser.created_at && userCreatedAtEl) {
    const date = new Date(currentUser.created_at);
    const formatted = date.toLocaleDateString('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    userCreatedAtEl.value = formatted;
    console.log("Set userCreatedAt to:", formatted);
  }
  
  // Load user profile from database
  console.log("Fetching user profile from DB...");
  const { data, error } = await sb
    .from("user_profiles")
    .select("first_name, last_name, company_name")
    .eq("id", currentUser.id)
    .single();
  
  console.log("User profile data:", data, "Error:", error);
  
  // Load first_name
  const userFirstNameEl = $("userFirstName");
  if (data && userFirstNameEl) {
    userFirstNameEl.value = data.first_name || "";
    console.log("Set first_name to:", data.first_name);
  }
  
  // Load last_name
  const userLastNameEl = $("userLastName");
  if (data && userLastNameEl) {
    userLastNameEl.value = data.last_name || "";
    console.log("Set last_name to:", data.last_name);
  }
  
  // Load company_name
  const userCompanyEl = $("userCompany");
  if (data && userCompanyEl) {
    userCompanyEl.value = data.company_name || "";
    console.log("Set company_name to:", data.company_name);
  }
  
  console.log("=== loadUserProfile END ===");
}

async function supabaseUpsertQuote(quoteData) {
  if (!currentUser) {
    console.log("User not logged in, skipping cloud sync");
    return { ok: false, error: "User not logged in" };
  }
  
  const sb = getAuthSupabaseClient();
  const payload = quoteData?.state || quoteData;
  const quoteId = quoteData?.quoteId || quoteData?.id || `quote_${Date.now()}`;
  const clientName = quoteData?.client || payload?.order?.client || "Senza nome";
  
  // Struttura corretta per la tabella quotes di Supabase (per utente)
  const dataToSave = {
    quote_id: quoteId,
    user_id: currentUser.id,
    client: clientName,
    payload,
    updated_at: new Date().toISOString()
  };
  
  try {
    // Usa upsert per INSERT o UPDATE automatico
    const result = await sb
      .from("quotes")
      .upsert(dataToSave, {
        onConflict: 'quote_id'
      });
    
    if (result.error) {
      console.error("Supabase upsert error:", result.error);
      return { ok: false, error: result.error.message };
    }
    
    console.log("Quote synced to Supabase", result);
    return { ok: true };
  } catch (err) {
    console.error("Exception in supabaseUpsertQuote:", err);
    return { ok: false, error: err.message };
  }
}

async function supabaseLoadQuotes() {
  if (!currentUser) {
    console.log("User not logged in, cannot load quotes");
    return [];
  }
  
  const sb = getAuthSupabaseClient();
  
  try {
    console.log("Loading quotes for user:", currentUser.id);
    const { data, error } = await sb
      .from("quotes")
      .select("quote_id, client, payload, updated_at")
      .eq("user_id", currentUser.id)
      .order("updated_at", { ascending: false });
    
    if (error) {
      console.error("Supabase load error:", error);
      return [];
    }
    
    console.log("Loaded quotes from Supabase:", data);
    return (data || []).map(r => {
      let total = 0;
      try { total = quoteOrder(r.payload).sums.total; } catch {}
      return {
        id: r.quote_id,
        quoteId: r.quote_id,
        client: r.client || r.payload?.order?.client || "Senza nome",
        date: r.updated_at || nowStr(),
        itemsCount: Array.isArray(r.payload?.items) ? r.payload.items.length : 0,
        total,
        status: r.payload?.order?.status || "DRAFT",
        state: r.payload
      };
    });
  } catch (err) {
    console.error("Exception in supabaseLoadQuotes:", err);
    return [];
  }
}

async function supabaseUpsertItem(itemData) {
  if (!currentUser) {
    console.log("User not logged in, skipping item cloud sync");
    return { ok: false, error: "User not logged in" };
  }
  
  const sb = getAuthSupabaseClient();
  const itemId = itemData?.id || `item_${Date.now()}`;
  const dataToSave = {
    item_id: itemId,
    user_id: currentUser.id,
    name: itemData?.name || "Articolo",
    payload: itemData,
    updated_at: new Date().toISOString()
  };
  
  try {
    const result = await sb
      .from("item_library")
      .upsert(dataToSave, { onConflict: "item_id" });
    
    if (result.error) {
      console.error("Supabase item upsert error:", result.error);
      return { ok: false, error: result.error.message };
    }
    
    console.log("Item synced to Supabase", result);
    return { ok: true };
  } catch (err) {
    console.error("Exception in supabaseUpsertItem:", err);
    return { ok: false, error: err.message };
  }
}

async function supabaseDeleteQuote(quoteId) {
  if (!currentUser) {
    console.log("User not logged in, cannot delete quote");
    return { ok: false, error: "User not logged in" };
  }
  
  const sb = getAuthSupabaseClient();
  
  try {
    const { error } = await sb
      .from("quotes")
      .delete()
      .eq("quote_id", quoteId)
      .eq("user_id", currentUser.id);
    
    if (error) {
      console.error("Supabase delete quote error:", error);
      return { ok: false, error: error.message };
    }
    
    console.log("Quote deleted from Supabase:", quoteId);
    return { ok: true };
  } catch (err) {
    console.error("Exception in supabaseDeleteQuote:", err);
    return { ok: false, error: err.message };
  }
}

async function supabaseDeleteItem(itemId) {
  if (!currentUser) {
    console.log("User not logged in, cannot delete item");
    return { ok: false, error: "User not logged in" };
  }
  
  const sb = getAuthSupabaseClient();
  
  try {
    const { error } = await sb
      .from("item_library")
      .delete()
      .eq("item_id", itemId)
      .eq("user_id", currentUser.id);
    
    if (error) {
      console.error("Supabase delete item error:", error);
      return { ok: false, error: error.message };
    }
    
    console.log("Item deleted from Supabase:", itemId);
    return { ok: true };
  } catch (err) {
    console.error("Exception in supabaseDeleteItem:", err);
    return { ok: false, error: err.message };
  }
}

async function supabaseLoadItems() {
  if (!currentUser) {
    console.log("User not logged in, cannot load items");
    return [];
  }
  
  const sb = getAuthSupabaseClient();
  
  try {
    console.log("Loading items for user:", currentUser.id);
    const { data, error } = await sb
      .from("item_library")
      .select("item_id, name, payload, updated_at")
      .eq("user_id", currentUser.id)
      .order("updated_at", { ascending: false });
    
    if (error) {
      console.error("Supabase load items error:", error);
      return [];
    }
    
    console.log("Loaded items from Supabase:", data);
    return (data || []).map(r => {
      let payload = r.payload;
      if (typeof payload === "string") {
        try { payload = JSON.parse(payload); } catch { payload = {}; }
      }
      return {
        ...payload,
        id: r.item_id,
        name: r.name || payload?.name || "Articolo",
        date: r.updated_at || nowStr()
      };
    });
  } catch (err) {
    console.error("Exception in supabaseLoadItems:", err);
    return [];
  }
}

async function saveUserProfile() {
  if (!currentUser) return;
  
  const firstName = document.getElementById("userFirstName")?.value || "";
  const lastName = document.getElementById("userLastName")?.value || "";
  const company = document.getElementById("userCompany")?.value || "";
  const sb = getAuthSupabaseClient();
  
  try {
    const { data, error } = await sb
      .from("user_profiles")
      .update({ 
        first_name: firstName,
        last_name: lastName,
        company_name: company
      })
      .eq("id", currentUser.id);
    
    if (error) {
      console.error("Error saving profile:", error);
      alert("Errore nel salvataggio: " + error.message);
    } else {
      console.log("Profile saved", data);
      alert("✅ Profilo salvato!");
    }
  } catch (err) {
    console.error("Exception in saveUserProfile:", err);
    alert("Errore: " + err.message);
  }
}

async function deleteAccount() {
  if (!currentUser) return;
  
  const firstConfirm = window.confirm(
    "⚠️  ELIMINAZIONE ACCOUNT\n\n" +
    "Stai per eliminare il tuo account e TUTTI i dati associati:\n\n" +
    "🗑️  Verranno cancellati:\n" +
    "   • Tutti i preventivi salvati\n" +
    "   • Tutti gli articoli e modelli\n" +
    "   • Il tuo profilo utente\n" +
    "   • Tutta la cronologia\n\n" +
    "⚠️  IMPORTANTE:\n" +
    "   • Questa azione NON è reversibile\n" +
    "   • I dati non potranno essere recuperati\n" +
    "   • Potrai reiscriverti dopo con la stessa email\n\n" +
    "Sei SICURO di voler continuare?"
  );
  
  if (!firstConfirm) {
    console.log("Account deletion cancelled by user");
    return;
  }
  
  const secondConfirm = window.confirm(
    "ULTIMA CONFERMA\n\n" +
    "Digita 'ELIMINA' nella prossima finestra per confermare l'eliminazione permanente dell'account.\n\n" +
    "Sei veramente sicuro?"
  );
  
  if (!secondConfirm) {
    console.log("Account deletion cancelled by user");
    return;
  }
  
  const userInput = window.prompt(
    "Per continuare, digita esattamente: ELIMINA\n\n" +
    "(Questo è per evitare cancellazioni accidentali)"
  );
  
  if (userInput !== "ELIMINA") {
    alert("Testo non corretto. Eliminazione annullata.");
    return;
  }
  
  try {
    const sb = getAuthSupabaseClient();
    
    console.log("Deleting user data for:", currentUser.id);
    
    // Chiama Edge Function per cancellare l'utente auth
    try {
      console.log("Calling delete_user Edge Function for user:", currentUser.id);
      
      const response = await fetch(
        "https://lfyyrhofxxfggsiwotgd.supabase.co/functions/v1/delete_user",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxmeXlyaG9meHhmZ2dzaXdvdGdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzc5OTI4MTIsImV4cCI6MjA1MzU2ODgxMn0.PuPOlA3lCikakg_E0ahojfN"
          },
          body: JSON.stringify({ userId: currentUser.id })
        }
      );
      
      console.log("Delete function response status:", response.status);
      const responseText = await response.text();
      console.log("Delete function response body:", responseText);
      
      if (response.ok) {
        console.log("Auth user deleted via Edge Function");
      } else {
        console.warn("Edge Function error:", response.status, responseText);
      }
    } catch (edgeFuncErr) {
      console.error("Exception calling delete_user Edge Function:", edgeFuncErr);
    }
    
    // Cancella tutti i preventivi dell'utente
    const quotesResult = await sb
      .from("quotes")
      .delete()
      .eq("user_id", currentUser.id);
    console.log("Quotes deletion result:", quotesResult);
    
    // Cancella tutti gli articoli dell'utente
    const itemsResult = await sb
      .from("item_library")
      .delete()
      .eq("user_id", currentUser.id);
    console.log("Items deletion result:", itemsResult);
    
    // Cancella il profilo utente usando Edge Function (bypassa RLS)
    try {
      console.log("Calling delete_user_profile Edge Function...");
      const profileDeleteResponse = await fetch(
        "https://lfyyrhofxxfggsiwotgd.supabase.co/functions/v1/delete_user_profile",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxmeXlyaG9meHhmZ2dzaXdvdGdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzc5OTI4MTIsImV4cCI6MjA1MzU2ODgxMn0.PuPOlA3lCikakg_E0ahojfN"
          },
          body: JSON.stringify({ userId: currentUser.id })
        }
      );
      
      console.log("Profile delete function response:", profileDeleteResponse.status);
      if (!profileDeleteResponse.ok) {
        const errorText = await profileDeleteResponse.text();
        console.warn("Profile delete error:", errorText);
      }
    } catch (profileErr) {
      console.error("Exception deleting profile:", profileErr);
    }
    
    console.log("User data deleted successfully");
    
    // Cancella TUTTO dal localStorage
    localStorage.clear();
    
    // Logout dell'utente
    await sb.auth.signOut();
    currentUser = null;
    
    // Pulisci localStorage (ridondante ma sicuro)
    clearAuthForms();
    
    // Mostra login screen
    showAuthScreen();
    
    alert("✅ Account eliminato con successo!\n\nTutti i tuoi dati sono stati rimossi dal sistema.\nPuoi reiscriverti quando vuoi!");
  } catch (err) {
    console.error("Exception in deleteAccount:", err);
    alert("❌ Errore durante l'eliminazione: " + err.message);
  }
}



/* ===========================
   TIME PARSER (the important part)
   Accept:
   - "1:30" => 1.5
   - "1.30" or "1,30" => 1h30 (minutes)  NOT 1.30 hours
   - "0.40" => 0h40
   - decimal hours: "0.67"
=========================== */
function parseHoursSmart(input, fallback=0) {
  if (input === null || input === undefined) return fallback;
  let s = String(input).trim();
  if (!s) return fallback;

  // normalize spaces
  s = s.replace(/\s+/g, "");

  // H:MM
  if (s.includes(":")) {
    const [hStr, mStr] = s.split(":");
    const h = num(hStr, 0);
    const m = num(mStr, 0);
    if (m < 0 || m >= 60) return h; // se sbagli minuti, almeno non esplode
    return h + (m / 60);
  }

  // H.MM or H,MM
  // If there is one separator and the "minutes" part is 0..59 and has 2 digits => treat as minutes
  const sepMatch = s.match(/^(\d+)[\.,](\d{1,2})$/);
  if (sepMatch) {
    const h = num(sepMatch[1], 0);
    const mmStr = sepMatch[2];
    const mm = num(mmStr, 0);

    // If user typed 1.30 or 0.40 -> minutes style (00..59) with 2 digits
    if (mmStr.length === 2 && mm >= 0 && mm <= 59) {
      return h + (mm / 60);
    }

    // Else treat as decimal hours
    return num(s, fallback);
  }

  // plain number -> decimal hours
  return num(s, fallback);
}

/* ===========================
   Core: quote item
=========================== */
function quoteItem(item, config) {
  const qty = Math.max(1, Math.floor(num(item.qty, 1)));
  const grams = Math.max(0, num(item.gramsPerPiece));
  const printHours = Math.max(0, parseHoursSmart(item.printHoursPerPiece, 0)); // SMART
  const groupKey = (item.group || "B").toUpperCase();
  const group = config.groups[groupKey] || config.groups.B;

  const hasDesign = item.hasDesign !== false;
  const designHours = hasDesign ? Math.max(0, parseHoursSmart(item.designHours, 0)) : 0; // SMART

  const materialEurPerGram = item.materialOverrideOn
    ? Math.max(0, num(item.materialEurPerGram))
    : Math.max(0, num(config.materialEurPerGram));

  const machineEurPerHour = Math.max(0, num(config.machineEurPerHour));
  const designEurPerHour = Math.max(0, num(config.designEurPerHour));
  const postProcessEurPerHour = Math.max(0, num(config.postProcessEurPerHour, 15));

  const postProcessHours = Math.max(0, parseHoursSmart(item.postProcessHours, 0));
  const postProcessExtras = Array.isArray(item.postProcessExtras) ? item.postProcessExtras : [];
  const postProcessExtrasCost = postProcessExtras.reduce((a, x) => a + Math.max(0, num(x?.price, 0)), 0);

  const seriesDiscountPct = Math.max(0, num(config.seriesDiscountPct));
  const seriesThresholdQty = Math.max(1, Math.floor(num(config.seriesThresholdQty, 10)));

  // Base costs
  const materialCost = grams * materialEurPerGram * qty;

  // Print: apply group factor to print portion
  const printCostBase = printHours * machineEurPerHour * qty;
  const printCost = printCostBase * Math.max(0, num(group.printFactor, 1));

  // Design: depends only on hasDesign, then apply group factor
  const designCostBase = hasDesign ? (designHours * designEurPerHour) : 0;
  const designCost = designCostBase * Math.max(0, num(group.designFactor, 1));

  // Post-process: hours * hourly rate + extras (no group factor)
  const postProcessCost = (postProcessHours * postProcessEurPerHour) + postProcessExtrasCost;

  const variableCosts = materialCost + printCost;

  // Series discount applies to variableCosts
  const isSeries = item.isSeries === true;
  const discountApplied = isSeries && qty >= seriesThresholdQty;
  const seriesDiscount = discountApplied ? variableCosts * seriesDiscountPct : 0;

  const itemBase = (variableCosts - seriesDiscount) + designCost + postProcessCost;

  const marginPct = Math.max(0, num(group.marginPct, 0.25));
  const itemMargin = itemBase * marginPct;

  const itemTotal = itemBase + itemMargin;
  const unitPrice = itemTotal / qty;

  return {
    qty,
    grams,
    printHours,
    designHours,
    postProcessHours,
    postProcessExtras,
    postProcessExtrasCost,
    groupKey,
    materialCost,
    printCostBase,
    printCost,
    designCostBase,
    designCost,
    postProcessCost,
    variableCosts,
    seriesDiscount,
    discountApplied,
    itemBase,
    marginPct,
    itemMargin,
    itemTotal,
    unitPrice,
    materialRate: materialEurPerGram,
    hasDesign,
    isSeries
  };
}

/* ===========================
   Core: quote order
=========================== */
function quoteOrder(state) {
  const cfg = state.config;
  const setupFee = Math.max(0, num(cfg.machineSetupFee));
  const setupMode = state.order.setupMode; // ORDER | ITEM

  const itemQuotes = state.items.map(it => ({ id: it.id, raw: it, q: quoteItem(it, cfg) }));

  const sumMat = itemQuotes.reduce((a,x)=> a + x.q.materialCost, 0);
  const sumPrint = itemQuotes.reduce((a,x)=> a + x.q.printCost, 0);
  const sumDesign = itemQuotes.reduce((a,x)=> a + x.q.designCost, 0);
  const sumPostProcess = itemQuotes.reduce((a,x)=> a + x.q.postProcessCost, 0);
  const sumDiscount = itemQuotes.reduce((a,x)=> a + x.q.seriesDiscount, 0);
  const sumMargin = itemQuotes.reduce((a,x)=> a + x.q.itemMargin, 0);
  const sumItemsTotal = itemQuotes.reduce((a,x)=> a + x.q.itemTotal, 0);

  // Calcolo setup
  // FUTURE: quando setupMode === "BATCH", sommare setup fee per batch, non per item
  // const setupApplied = (setupMode === "BATCH") 
  //   ? (state.batches?.reduce((a,b) => a + b.setupFee, 0) ?? 0)
  //   : (setupMode === "ITEM") ? setupFee * state.items.length : setupFee;
  const setupApplied = state.items.length === 0 ? 0 : ((setupMode === "ITEM") ? setupFee * state.items.length : setupFee);
  const total = sumItemsTotal + setupApplied;

  return {
    itemQuotes,
    sums: { sumMat, sumPrint, sumDesign, sumPostProcess, sumDiscount, sumMargin, setupApplied, total }
  };
}

/* ===========================
   State
=========================== */
const STORAGE_KEY = "preventivatore3d_multi_groups_pdf_v2";
const LIBRARY_KEY = "preventivatore3d_library_v1";
const ITEM_LIBRARY_KEY = "preventivatore3d_item_library_v1";
const CLOUD_KEY = "preventivatore3d_cloud_settings_v1";
const THEME_KEY = "preventivatore3d_theme_v1";
const LAST_USER_KEY = "preventivatore3d_last_user_id_v1";

let activeUserId = "anon";

function getUserScopedKey(baseKey) {
  return `${baseKey}::${activeUserId}`;
}

function setActiveUserData(user) {
  activeUserId = user?.id || "anon";
  state = loadState();
  library = loadLibrary();
  itemLibrary = loadItemLibrary();

  if (typeof renderLibrary === "function") renderLibrary();
  if (typeof renderItemLibrary === "function") renderItemLibrary();
}

function handleUserChange(newUser) {
  const lastUserId = localStorage.getItem(LAST_USER_KEY);
  const newUserId = newUser?.id || "";

  if (newUserId) {
    if (!lastUserId || lastUserId !== newUserId) {
      console.log("🔄 User changed, switching local data cache");
      dataLoadedOnce = false;
    }
    setActiveUserData(newUser);
    localStorage.setItem(LAST_USER_KEY, newUserId);
  } else {
    console.log("🔄 Logout, switching to anon cache");
    dataLoadedOnce = false;
    setActiveUserData(null);
    // non rimuoviamo LAST_USER_KEY per confrontarlo al prossimo login
  }
}

const DEFAULTS = {
  order: { client: "", setupMode: "ORDER", quoteId: "", status: "DRAFT" },
  config: {
    materialEurPerGram: 0.15,
    machineEurPerHour: 2,
    designEurPerHour: 20,
    postProcessEurPerHour: 15,
    machineSetupFee: 10,
    seriesDiscountPct: 0.25,
    seriesThresholdQty: 10,
    pdf: {
      showGrams: true,
      showHours: true,
      showSetup: true,
      showDiscount: true,
      showMargin: true,
      showBaseCosts: true
    },
    groups: {
      A: { printFactor: 1.00, designFactor: 0.80, marginPct: 0.20 },
      B: { printFactor: 1.10, designFactor: 1.00, marginPct: 0.25 },
      C: { printFactor: 1.25, designFactor: 1.30, marginPct: 0.35 }
    }
  },
  items: [
    {
      id: uid(),
      name: "",
      imageUrl: "",
      group: "B",
      qty: "",
      gramsPerPiece: "",
      printHoursPerPiece: "",
      hasDesign: false,
      designHours: "",
      postProcessHours: "",
      postProcessNotes: "",
      postProcessExtras: [],
      isSeries: false,
      materialOverrideOn: false,
      materialEurPerGram: 0.15,
      // FUTURE: batchGroup: null  (per raggruppare articoli che vengono stampati insieme)
    }
  ]
  // FUTURE: batches array per gestire "mandate" (setup una volta per gruppo di articoli)
  // batches: [{ id, name, setupFee, itemIds: [] }]
};

function generateQuoteId(){
  const d = new Date();
  const pad = (n)=> String(n).padStart(2,"0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `Q-${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${ms}-${rnd}`;
}

function loadState() {
  try {
    const raw = localStorage.getItem(getUserScopedKey(STORAGE_KEY));
    if (!raw) return structuredClone(DEFAULTS);
    const parsed = JSON.parse(raw);
    const s = {
      order: { ...DEFAULTS.order, ...(parsed.order || {}) },
      config: { ...DEFAULTS.config, ...(parsed.config || {}) },
      items: Array.isArray(parsed.items) && parsed.items.length ? parsed.items : structuredClone(DEFAULTS.items)
    };
    s.config.groups = { ...DEFAULTS.config.groups, ...((parsed.config && parsed.config.groups) || {}) };
    s.config.pdf = { ...DEFAULTS.config.pdf, ...((parsed.config && parsed.config.pdf) || {}) };
    return s;
  } catch {
    return structuredClone(DEFAULTS);
  }
}
function saveState(s){ localStorage.setItem(getUserScopedKey(STORAGE_KEY), JSON.stringify(s)); }

function loadLibrary() {
  try {
    const raw = localStorage.getItem(getUserScopedKey(LIBRARY_KEY));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function saveLibrary(list){ localStorage.setItem(getUserScopedKey(LIBRARY_KEY), JSON.stringify(list)); }

function loadItemLibrary(){
  try{
    const key = getUserScopedKey(ITEM_LIBRARY_KEY);
    const activeId = activeUserId;
    console.log(`📂 Caricando articoli da: "${key}" (activeUserId=${activeId})`);
    const raw = localStorage.getItem(key);
    console.log(`📂 Dati trovati: ${raw ? 'SI (' + raw.length + ' chars)' : 'NO'}`);
    if(!raw) {
      const countEl = document.getElementById('itemCountValue');
      if(countEl) countEl.textContent = '0';
      console.log(`📂 ⚠️ Nessun dato nel localStorage per "${key}"`);
      return [];
    }
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed) ? parsed : [];
    
    // Aggiorna il debug badge
    const countEl = document.getElementById('itemCountValue');
    if(countEl) countEl.textContent = items.length;
    
    console.log(`📂 ✅ Caricati ${items.length} articoli da localStorage (key="${key}")`);
    return items;
  }catch(e){
    console.error(`📂 ❌ Errore caricamento: ${e.message}`);
    const countEl = document.getElementById('itemCountValue');
    if(countEl) countEl.textContent = '0';
    return [];
  }
}
function saveItemLibrary(list){ 
  const key = getUserScopedKey(ITEM_LIBRARY_KEY);
  const activeId = activeUserId;
  console.log(`💾 Salvando ${list.length} articoli con chiave: "${key}" (activeUserId=${activeId})`);
  try{
    localStorage.setItem(key, JSON.stringify(list));
    console.log(`💾 ✅ Salvati ${list.length} articoli in "${key}"`);
  }catch(e){
    console.error(`💾 ❌ Errore salvataggio: ${e.message}`);
  }
  
  // Aggiorna il debug badge
  const countEl = document.getElementById('itemCountValue');
  if(countEl) countEl.textContent = list.length;
}

function loadCloudSettings(){
  try{
    const raw = localStorage.getItem(CLOUD_KEY);
    if(!raw) return { enabled: false, url: "", anonKey: "" };
    const parsed = JSON.parse(raw);
    return {
      enabled: !!parsed.enabled,
      url: parsed.url || "",
      anonKey: parsed.anonKey || ""
    };
  }catch{
    return { enabled: false, url: "", anonKey: "" };
  }
}
function saveCloudSettings(s){ localStorage.setItem(CLOUD_KEY, JSON.stringify(s)); }

let state = loadState();
let library = loadLibrary();
let itemLibrary = loadItemLibrary();
let currentItemTargetId = null;
let currentEditItemId = null;
let cloud = loadCloudSettings();

function clearItemEditForm(){
  currentEditItemId = null;
  if(!ui.itemEditName) return;
  ui.itemEditName.value = "";
  ui.itemEditGroup.value = "B";
  ui.itemEditGrams.value = "";
  ui.itemEditPrintHours.value = "";
  ui.itemEditDesignHours.value = "";
  ui.itemEditHasDesign.checked = true;
  ui.itemEditIsSeries.checked = false;
  ui.itemEditMaterialOverride.checked = false;
  if(ui.itemEditMaterialField) ui.itemEditMaterialField.style.display = "none";
  ui.itemEditMaterialCost.value = "";
  if(ui.itemEditImageUrl) ui.itemEditImageUrl.value = "";
  if(ui.itemEditImageFile) ui.itemEditImageFile.value = "";
  ui.itemEditSave.textContent = "Salva articolo";
}

function loadItemEditForm(itemId){
  const item = itemLibrary.find(x=>x.id===itemId);
  if(!item) return;
  currentEditItemId = itemId;
  ui.itemEditName.value = item.name || "";
  ui.itemEditGroup.value = item.group || "B";
  ui.itemEditGrams.value = fmtComma(item.gramsPerPiece || "");
  ui.itemEditPrintHours.value = item.printHoursPerPiece || "";
  ui.itemEditDesignHours.value = fmtComma(item.designHours || "");
  ui.itemEditHasDesign.checked = item.hasDesign !== false;
  ui.itemEditIsSeries.checked = item.isSeries === true;
  ui.itemEditMaterialOverride.checked = item.materialOverrideOn === true;
  ui.itemEditMaterialCost.value = fmtComma(item.materialEurPerGram || "");
  if(ui.itemEditImageUrl) ui.itemEditImageUrl.value = item.imageUrl || "";
  if(ui.itemEditImageFile) ui.itemEditImageFile.value = "";
  if(ui.itemEditMaterialField) ui.itemEditMaterialField.style.display = item.materialOverrideOn ? "" : "none";
  ui.itemEditSave.textContent = "Aggiorna articolo";
}

/* ===========================
   DOM
=========================== */
const $ = (id) => document.getElementById(id);

const ui = {
  client: $("client"),
  setupMode: $("setupMode"),
  addItem: $("addItem"),
  reset: $("reset"),
  exportPdf: $("exportPdf"),
  items: $("items"),
  copy: $("copy"),

  saveQuote: $("saveQuote"),
  saveCopy: $("saveCopy"),
  openBackup: $("openBackup"),
  backupModal: $("backupModal"),
  closeBackup: $("closeBackup"),
  exportBackup: $("exportBackup"),
  clearLibrary: $("clearLibrary"),
  libraryList: $("libraryList"),
  librarySearch: $("librarySearch"),
  libraryStatus: $("libraryStatus"),
  quoteCodeLabel: $("quoteCodeLabel"),
  backupText: $("backupText"),
  importBackup: $("importBackup"),
  copyBackup: $("copyBackup"),

  itemLibraryModal: $("itemLibraryModal"),
  closeItemLibrary: $("closeItemLibrary"),
  itemLibraryList: $("itemLibraryList"),
  itemSearch: $("itemSearch"),
  itemsSearch: $("itemsSearch"),
  itemsGroup: $("itemsGroup"),
  itemsListView: $("itemsListView"),

  itemEditName: $("itemEditName"),
  itemEditGroup: $("itemEditGroup"),
  itemEditGrams: $("itemEditGrams"),
  itemEditPrintHours: $("itemEditPrintHours"),
  itemEditDesignHours: $("itemEditDesignHours"),
  itemEditHasDesign: $("itemEditHasDesign"),
  itemEditIsSeries: $("itemEditIsSeries"),
  itemEditMaterialOverride: $("itemEditMaterialOverride"),
  itemEditMaterialCost: $("itemEditMaterialCost"),
  itemEditMaterialField: $("itemEditMaterialField"),
  itemEditImageUrl: $("itemEditImageUrl"),
  itemEditImageFile: $("itemEditImageFile"),
  itemEditCameraCapture: $("itemEditCameraCapture"),
  itemEditGalleryBtn: $("itemEditGalleryBtn"),
  itemEditCameraBtn: $("itemEditCameraBtn"),
  itemImagePreview: $("itemImagePreview"),
  itemImagePreviewImg: $("itemImagePreviewImg"),
  itemEditSave: $("itemEditSave"),
  itemEditCancel: $("itemEditCancel"),

  cloudUrl: $("cloudUrl"),
  cloudKey: $("cloudKey"),
  cloudEnabled: $("cloudEnabled"),
  cloudSave: $("cloudSave"),
  cloudPull: $("cloudPull"),
  cloudPush: $("cloudPush"),
  cloudStatus: $("cloudStatus"),

  orderStatus: $("orderStatus"),
  reportStart: $("reportStart"),
  reportEnd: $("reportEnd"),
  reportPreset: $("reportPreset"),
  reportStatus: $("reportStatus"),
  reportCalc: $("reportCalc"),
  reportOut: $("reportOut"),
  reportMonth: $("reportMonth"),
  reportYear: $("reportYear"),
  reportCsv: $("reportCsv"),
  reportChart: $("reportChart"),

  openMenu: $("openMenu"),
  closeMenu: $("closeMenu"),
  menuOverlay: $("menuOverlay"),
  sideMenu: $("sideMenu"),
  viewMain: $("view-main"),
  viewLibrary: $("view-library"),
  viewItems: $("view-items"),
  viewReport: $("view-report"),
  viewAccount: $("view-account"),

  themeSelect: $("themeSelect"),
  pdfShowGrams: $("pdfShowGrams"),
  pdfShowHours: $("pdfShowHours"),
  pdfShowSetup: $("pdfShowSetup"),
  pdfShowDiscount: $("pdfShowDiscount"),
  pdfShowMargin: $("pdfShowMargin"),
  pdfShowBaseCosts: $("pdfShowBaseCosts"),

  cfg_material: $("cfg_material"),
  cfg_machine: $("cfg_machine"),
  cfg_design: $("cfg_design"),
  cfg_postProcess: $("cfg_postProcess"),
  cfg_setup: $("cfg_setup"),
  cfg_discount: $("cfg_discount"),
  cfg_threshold: $("cfg_threshold"),

  gA_print: $("gA_print"),
  gA_design: $("gA_design"),
  gA_margin: $("gA_margin"),
  gB_print: $("gB_print"),
  gB_design: $("gB_design"),
  gB_margin: $("gB_margin"),
  gC_print: $("gC_print"),
  gC_design: $("gC_design"),
  gC_margin: $("gC_margin"),

  total: $("total"),
  noteKpi: $("noteKpi"),
  sumMat: $("sumMat"),
  sumPrint: $("sumPrint"),
  sumDesign: $("sumDesign"),
  sumPostProcess: $("sumPostProcess"),
  sumDiscount: $("sumDiscount"),
  sumSetup: $("sumSetup"),
  sumMargin: $("sumMargin"),
  sumTotal: $("sumTotal"),
  note: $("note"),

  // print
  printHead: $("printHead"),
  printMeta: $("printMeta"),
  printItems: $("printItems"),
  printItemsTotals: $("printItemsTotals"),
  printPostProcessBox: $("printPostProcessBox"),
  printPostProcessList: $("printPostProcessList"),
  p_sumMat: $("p_sumMat"),
  p_sumPrint: $("p_sumPrint"),
  p_sumDesign: $("p_sumDesign"),
  p_sumPostProcess: $("p_sumPostProcess"),
  p_sumDiscount: $("p_sumDiscount"),
  p_sumSetup: $("p_sumSetup"),
  p_sumMargin: $("p_sumMargin"),
  p_total: $("p_total"),
  p_rowPostProcess: $("p_rowPostProcess"),
  p_rowDiscount: $("p_rowDiscount"),
  p_rowSetup: $("p_rowSetup"),
  p_rowMargin: $("p_rowMargin"),
  printFoot: $("printFoot"),
};

function applyTheme(theme){
  const t = theme === "dark" ? "dark" : "light";
  document.body.setAttribute("data-theme", t);
  if(ui.themeSelect) ui.themeSelect.value = t;
  localStorage.setItem(THEME_KEY, t);
}

function initTheme(){
  const saved = localStorage.getItem(THEME_KEY) || "light";
  applyTheme(saved);
}

function openMenu(){
  ui.sideMenu?.classList.add("open");
  ui.sideMenu?.setAttribute("aria-hidden", "false");
  ui.menuOverlay?.classList.add("open");
  ui.menuOverlay?.setAttribute("aria-hidden", "false");
}
function closeMenu(){
  ui.sideMenu?.classList.remove("open");
  ui.sideMenu?.setAttribute("aria-hidden", "true");
  ui.menuOverlay?.classList.remove("open");
  ui.menuOverlay?.setAttribute("aria-hidden", "true");
}

function setView(view){
  const views = [ui.viewMain, ui.viewLibrary, ui.viewItems, ui.viewReport, ui.viewAccount].filter(Boolean);
  views.forEach(v=>v.classList.remove("view-active"));
  if(view === "library") ui.viewLibrary?.classList.add("view-active");
  else if(view === "items") ui.viewItems?.classList.add("view-active");
  else if(view === "report") ui.viewReport?.classList.add("view-active");
  else if(view === "account") {
    ui.viewAccount?.classList.add("view-active");
    loadUserProfile();
  }
  else ui.viewMain?.classList.add("view-active");
  if(view === "library") renderLibrary();
  if(view === "items") renderItemsView();
  closeMenu();
}

function bindTop(){
  ui.client.value = state.order.client;
  ui.setupMode.value = state.order.setupMode;
  if(ui.orderStatus) ui.orderStatus.value = state.order.status || "DRAFT";
  if(ui.quoteCodeLabel){
    ui.quoteCodeLabel.textContent = state.order.quoteId
      ? `Codice preventivo: ${state.order.quoteId}`
      : "Codice preventivo: —";
  }

  if(ui.cloudUrl) ui.cloudUrl.value = cloud.url;
  if(ui.cloudKey) ui.cloudKey.value = cloud.anonKey;
  if(ui.cloudEnabled) ui.cloudEnabled.checked = !!cloud.enabled;
  if(ui.cloudStatus){
    ui.cloudStatus.textContent = cloud.enabled ? "Cloud attivo." : "Cloud disattivato.";
  }

  ui.cfg_material.value = fmtComma(state.config.materialEurPerGram);
  ui.cfg_machine.value = fmtComma(state.config.machineEurPerHour);
  ui.cfg_design.value = fmtComma(state.config.designEurPerHour);
  ui.cfg_postProcess.value = fmtComma(state.config.postProcessEurPerHour || 15);
  ui.cfg_setup.value = fmtComma(state.config.machineSetupFee);
  ui.cfg_discount.value = String(Math.round(state.config.seriesDiscountPct * 100));
  ui.cfg_threshold.value = String(state.config.seriesThresholdQty);

  const g = state.config.groups;
  ui.gA_print.value = fmtComma(g.A.printFactor);
  ui.gA_design.value = fmtComma(g.A.designFactor);
  ui.gA_margin.value = String(Math.round(g.A.marginPct * 100));

  ui.gB_print.value = fmtComma(g.B.printFactor);
  ui.gB_design.value = fmtComma(g.B.designFactor);
  ui.gB_margin.value = String(Math.round(g.B.marginPct * 100));

  ui.gC_print.value = fmtComma(g.C.printFactor);
  ui.gC_design.value = fmtComma(g.C.designFactor);
  ui.gC_margin.value = String(Math.round(g.C.marginPct * 100));

  const pdf = { ...DEFAULTS.config.pdf, ...(state.config.pdf || {}) };
  if(ui.pdfShowGrams) ui.pdfShowGrams.checked = !!pdf.showGrams;
  if(ui.pdfShowHours) ui.pdfShowHours.checked = !!pdf.showHours;
  if(ui.pdfShowSetup) ui.pdfShowSetup.checked = !!pdf.showSetup;
  if(ui.pdfShowDiscount) ui.pdfShowDiscount.checked = !!pdf.showDiscount;
  if(ui.pdfShowMargin) ui.pdfShowMargin.checked = !!pdf.showMargin;
  if(ui.pdfShowBaseCosts) ui.pdfShowBaseCosts.checked = !!pdf.showBaseCosts;
}

function readTop(){
  state.order.client = ui.client.value.trim();
  state.order.setupMode = ui.setupMode.value;
  state.order.status = ui.orderStatus?.value || "DRAFT";

  state.config.materialEurPerGram = num(ui.cfg_material.value);
  state.config.machineEurPerHour = num(ui.cfg_machine.value);
  state.config.designEurPerHour = num(ui.cfg_design.value);
  state.config.postProcessEurPerHour = num(ui.cfg_postProcess.value, 15);
  state.config.machineSetupFee = num(ui.cfg_setup.value);
  state.config.seriesDiscountPct = num(ui.cfg_discount.value) / 100;
  state.config.seriesThresholdQty = Math.max(1, Math.floor(num(ui.cfg_threshold.value, 10)));

  state.config.groups.A.printFactor = num(ui.gA_print.value, 1);
  state.config.groups.A.designFactor = num(ui.gA_design.value, 1);
  state.config.groups.A.marginPct = num(ui.gA_margin.value, 20) / 100;

  state.config.groups.B.printFactor = num(ui.gB_print.value, 1);
  state.config.groups.B.designFactor = num(ui.gB_design.value, 1);
  state.config.groups.B.marginPct = num(ui.gB_margin.value, 25) / 100;

  state.config.groups.C.printFactor = num(ui.gC_print.value, 1);
  state.config.groups.C.designFactor = num(ui.gC_design.value, 1);
  state.config.groups.C.marginPct = num(ui.gC_margin.value, 35) / 100;

  state.config.pdf = {
    showGrams: ui.pdfShowGrams ? ui.pdfShowGrams.checked : true,
    showHours: ui.pdfShowHours ? ui.pdfShowHours.checked : true,
    showSetup: ui.pdfShowSetup ? ui.pdfShowSetup.checked : true,
    showDiscount: ui.pdfShowDiscount ? ui.pdfShowDiscount.checked : true,
    showMargin: ui.pdfShowMargin ? ui.pdfShowMargin.checked : true,
    showBaseCosts: ui.pdfShowBaseCosts ? ui.pdfShowBaseCosts.checked : true
  };
}

function itemTemplate(it, idx){
  const hasDesign = it.hasDesign !== false;
  const displayName = (it.name || `Articolo ${idx+1}`).trim() || `Articolo ${idx+1}`;
  const qtyDisplay = Number.isFinite(Number(it.qty)) && Number(it.qty) > 0 ? Math.floor(Number(it.qty)) : 1;
  const extras = Array.isArray(it.postProcessExtras) ? it.postProcessExtras : [];

  return `
  <details class="item" data-id="${it.id}">
    <summary class="item-summary">
      <div class="item-summary-left">
        <img class="item-thumb js-item-thumb" src="${escapeHtml(it.imageUrl || "")}" alt="${escapeHtml(displayName)}" style="display:${it.imageUrl ? "block" : "none"}" />
        <div class="item-thumb placeholder js-item-thumb-placeholder" style="display:${it.imageUrl ? "none" : "flex"}">—</div>
        <div class="item-summary-text">
          <div class="item-summary-title" data-summary-name>${escapeHtml(displayName)}</div>
          <div class="item-summary-sub">Pezzi: <b data-summary-qty>${qtyDisplay}</b></div>
        </div>
      </div>
      <div class="item-summary-right">
        <span class="chip">Gruppo <b>${escapeHtml((it.group||"B").toUpperCase())}</b></span>
      </div>
    </summary>

    <div class="item-body">
      <div class="item-head">
        <div>
          <b>Articolo ${idx+1}</b> <span class="mini">(${it.id})</span>
        </div>
        <div class="item-actions">
          <button type="button" data-act="saveItem">Salva articolo</button>
          <button type="button" data-act="pickItem">Carica articolo</button>
          <button type="button" data-act="remove">Rimuovi</button>
        </div>
      </div>

      <div class="grid2">
      <div class="field span2">
        <label>Nome articolo</label>
        <input data-k="name" value="${escapeHtml(it.name)}" placeholder="Es. Staffe porta" />
      </div>

      <div class="field span2">
        <label>Immagine articolo (URL)</label>
        <input data-k="imageUrl" value="${escapeHtml(it.imageUrl || "")}" placeholder="https://..." />
      </div>

      <div class="field span2">
        <label>Carica immagine</label>
        <div style="display: flex; gap: 8px;">
          <input data-k="imageFile" type="file" accept="image/*" style="display: none;" />
          <input data-k="imageCamera" type="file" accept="image/*" capture="environment" style="display: none;" />
          <button type="button" data-act="pickGallery" style="flex: 1; padding: 10px; background: var(--primary); color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">🖼️ Galleria</button>
          <button type="button" data-act="capturePhoto" style="flex: 1; padding: 10px; background: var(--primary); color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">📷 Fotocamera</button>
        </div>
        <p style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">💡 Carica da galleria o scatta una foto</p>
      </div>

      <div class="field span2">
        <label>Anteprima immagine</label>
        <div class="item-preview">
          ${it.imageUrl ? `<img src="${escapeHtml(it.imageUrl)}" alt="${escapeHtml(it.name || "Articolo")}" />` : `<div class="item-preview placeholder">Nessuna immagine</div>`}
        </div>
      </div>

      <div class="field">
        <label>Gruppo (A/B/C)</label>
        <select data-k="group">
          <option value="A" ${String(it.group).toUpperCase()==="A"?"selected":""}>A — semplice</option>
          <option value="B" ${String(it.group).toUpperCase()==="B"?"selected":""}>B — standard</option>
          <option value="C" ${String(it.group).toUpperCase()==="C"?"selected":""}>C — complesso</option>
        </select>
      </div>

      <div class="field">
        <label>Quantità (pz)</label>
        <input data-k="qty" type="text" inputmode="numeric" value="${it.qty}" />
      </div>
      <div class="field">
        <label>Grammi per pezzo</label>
        <input data-k="gramsPerPiece" type="text" inputmode="numeric" value="${it.gramsPerPiece}" />
      </div>
      <div class="field">
        <label>Ore stampa per pezzo</label>
        <input data-k="printHoursPerPiece" type="text" placeholder="Es. 0:40 / 1.30 / 0,67" value="${escapeHtml(it.printHoursPerPiece)}" />
      </div>

      <div class="field">
        <label>Progettazione inclusa?</label>
        <div class="checkline">
          <input data-k="hasDesign" type="checkbox" ${hasDesign ? "checked" : ""} />
          <span data-k-label="hasDesign">${hasDesign ? "SI" : "NO (file pronto)"}</span>
        </div>
      </div>

      <div class="field">
        <label>Ore progettazione (totali)</label>
        <input data-k="designHours" type="text" placeholder="Es. 0:20 / 0.20 / 0,33"
          value="${escapeHtml(it.designHours)}" ${hasDesign ? "" : "disabled"} />
      </div>

      <div class="field">
        <label>Ore post-produzione (totali)</label>
        <input data-k="postProcessHours" type="text" placeholder="Es. 1:30 / 2.00 / 0,5"
          value="${escapeHtml(it.postProcessHours || "")}" />
      </div>

      <div class="field span2">
        <label>Note lavorazioni (LED, lucidatura, assemblaggio...)</label>
        <textarea data-k="postProcessNotes" rows="2" placeholder="Es. Installazione LED + lucidatura finale">${escapeHtml(it.postProcessNotes || "")}</textarea>
      </div>

      <div class="field span2">
        <label>Componenti extra (nome e prezzo)</label>
        <div class="extras-list" data-k="postProcessExtras">
          ${extras.map((ex, i)=>`
            <div class="extras-row" data-extra-row>
              <input data-extra-name type="text" placeholder="Nome extra" value="${escapeHtml(ex?.name || "")}" />
              <input data-extra-price type="text" inputmode="decimal" placeholder="Prezzo" value="${escapeHtml(ex?.price ?? "")}" />
              <button type="button" class="extras-remove" data-act="removeExtra" title="Rimuovi">−</button>
            </div>
          `).join("")}
        </div>
        <button type="button" class="extras-add" data-act="addExtra">+ Aggiungi extra</button>
      </div>

      <div class="field">
        <label>Serie (sconto se ≥ soglia)</label>
        <div class="checkline">
          <input data-k="isSeries" type="checkbox" ${it.isSeries ? "checked" : ""} />
          <span data-k-label="isSeries">${it.isSeries ? "SI" : "NO"}</span>
        </div>
      </div>

      <div class="field">
        <label>Materiale personalizzato</label>
        <div class="checkline">
          <input data-k="materialOverrideOn" type="checkbox" ${it.materialOverrideOn ? "checked" : ""} />
          <span data-k-label="matOverride">${it.materialOverrideOn ? "ON" : "USA DEFAULT"}</span>
        </div>
      </div>

      <div class="field">
        <label>€/g (se ON)</label>
        <input data-k="materialEurPerGram" type="text" inputmode="decimal"
          value="${fmtComma(it.materialEurPerGram)}" ${it.materialOverrideOn ? "" : "disabled"} />
      </div>
      </div>

      <div class="note" data-out="rowResult"></div>
    </div>
  </details>`;
}

function renderItems(preserveOpen = true){
  const openIds = preserveOpen && ui.items
    ? [...ui.items.querySelectorAll(".item[open]")].map(el => el.getAttribute("data-id"))
    : [];

  ui.items.innerHTML = state.items.map(itemTemplate).join("");

  if(openIds.length){
    openIds.forEach(id => {
      if(!id) return;
      const el = ui.items.querySelector(`.item[data-id="${id}"]`);
      if(el) el.setAttribute("open", "");
    });
  }
}

function readItemsFromDOM(){
  const wrappers = [...ui.items.querySelectorAll(".item")];
  state.items = wrappers.map(w=>{
    const id = w.getAttribute("data-id");
    const old = state.items.find(x=>x.id===id) || {};
    const get = (k)=> w.querySelector(`[data-k="${k}"]`);
    const hasDesign = get("hasDesign").checked;
    const materialOverrideOn = get("materialOverrideOn").checked;
    const extrasRows = [...w.querySelectorAll("[data-extra-row]")];
    const postProcessExtras = extrasRows.map(row => {
      const name = row.querySelector("[data-extra-name]")?.value?.trim() || "";
      const priceRaw = row.querySelector("[data-extra-price]")?.value?.trim() || "";
      const price = num(priceRaw, 0);
      return { name, price };
    }).filter(x => x.name || x.price > 0);

    return {
      ...old,
      id,
      name: get("name").value,
      imageUrl: get("imageUrl")?.value?.trim() || "",
      group: get("group").value,
      qty: num(get("qty").value, 1),
      gramsPerPiece: num(get("gramsPerPiece").value, 0),
      // keep strings, parser will interpret
      printHoursPerPiece: get("printHoursPerPiece").value.trim(),
      hasDesign,
      designHours: hasDesign ? get("designHours").value.trim() : "0:00",
      postProcessHours: get("postProcessHours").value.trim(),
      postProcessNotes: get("postProcessNotes").value.trim(),
      postProcessExtras,
      isSeries: get("isSeries").checked,
      materialOverrideOn,
      materialEurPerGram: materialOverrideOn ? num(get("materialEurPerGram").value, state.config.materialEurPerGram) : state.config.materialEurPerGram
    };
  });
}

function syncItemSummaries(){
  const wrappers = [...ui.items.querySelectorAll(".item")];
  wrappers.forEach(w=>{
    const id = w.getAttribute("data-id");
    const it = state.items.find(x=>x.id===id);
    if(!it) return;
    const nameEl = w.querySelector("[data-summary-name]");
    const qtyEl = w.querySelector("[data-summary-qty]");
    const imgEl = w.querySelector(".js-item-thumb");
    const phEl = w.querySelector(".js-item-thumb-placeholder");

    const displayName = (it.name || "Articolo").trim() || "Articolo";
    const qtyDisplay = Number.isFinite(Number(it.qty)) && Number(it.qty) > 0 ? Math.floor(Number(it.qty)) : 1;

    if(nameEl) nameEl.textContent = displayName;
    if(qtyEl) qtyEl.textContent = String(qtyDisplay);

    const hasImg = !!it.imageUrl;
    if(imgEl){
      imgEl.src = it.imageUrl || "";
      imgEl.alt = displayName;
      imgEl.style.display = hasImg ? "block" : "none";
    }
    if(phEl){
      phEl.style.display = hasImg ? "none" : "flex";
    }
  });
}

/* ===========================
   Item Library (storico articoli)
=========================== */
function normalizeItemForLibrary(it){
  return {
    id: uid(),
    name: (it.name || "Articolo").trim(),
    imageUrl: it.imageUrl || "",
    group: it.group || "B",
    qty: it.qty,
    gramsPerPiece: it.gramsPerPiece,
    printHoursPerPiece: it.printHoursPerPiece,
    hasDesign: it.hasDesign !== false,
    designHours: it.designHours,
    postProcessHours: it.postProcessHours,
    postProcessNotes: it.postProcessNotes,
    postProcessExtras: Array.isArray(it.postProcessExtras) ? it.postProcessExtras : [],
    isSeries: it.isSeries === true,
    materialOverrideOn: it.materialOverrideOn === true,
    materialEurPerGram: it.materialEurPerGram,
    date: nowStr()
  };
}

function renderItemLibrary(){
  if(!ui.itemLibraryList) return;
  const q = (ui.itemSearch?.value || "").trim().toLowerCase();
  const filtered = q
    ? itemLibrary.filter(x => (x.name || "").toLowerCase().includes(q))
    : itemLibrary;

  if(!filtered.length){
    ui.itemLibraryList.innerHTML = `<div class="note">Nessun articolo nello storico.</div>`;
    return;
  }

  ui.itemLibraryList.innerHTML = filtered.map(x=>`
    <div class="library-item" data-id="${x.id}">
      <div class="library-head">
        <div class="library-row">
          ${x.imageUrl ? `<img class="item-thumb" src="${escapeHtml(x.imageUrl)}" alt="${escapeHtml(x.name || "Articolo")}" />` : `<div class="item-thumb placeholder">—</div>`}
          <div>
            <b>${escapeHtml(x.name || "Articolo")}</b>
            <div class="library-meta">${escapeHtml(x.date)} — Gruppo ${escapeHtml(String(x.group || "B").toUpperCase())}</div>
          </div>
        </div>
        <div class="library-actions">
          <button type="button" data-itemlib="use">Inserisci</button>
          <button type="button" data-itemlib="delete">Elimina</button>
        </div>
      </div>
    </div>
  `).join("");
}

function openItemLibrary(targetId){
  currentItemTargetId = targetId;
  ui.itemLibraryModal?.classList.add("open");
  ui.itemLibraryModal?.setAttribute("aria-hidden", "false");
  renderItemLibrary();
}
function closeItemLibrary(){
  ui.itemLibraryModal?.classList.remove("open");
  ui.itemLibraryModal?.setAttribute("aria-hidden", "true");
}

function renderItemsView(){
  if(!ui.itemsListView) return;
  if(!itemLibrary.length){
    ui.itemsListView.innerHTML = `<div class="note">Nessun articolo salvato.</div>`;
    return;
  }

  const q = (ui.itemsSearch?.value || "").trim().toLowerCase();
  const group = ui.itemsGroup?.value || "ALL";

  const filtered = itemLibrary.filter(x=>{
    if(group !== "ALL" && String(x.group || "B").toUpperCase() !== group) return false;
    if(!q) return true;
    const name = String(x.name || "").toLowerCase();
    return name.includes(q);
  });

  if(!filtered.length){
    ui.itemsListView.innerHTML = `<div class="note">Nessun articolo trovato.</div>`;
    return;
  }

  ui.itemsListView.innerHTML = filtered.map(x=>`
    <div class="library-item" data-id="${x.id}">
      <div class="library-head">
        <div class="library-row">
          ${x.imageUrl ? `<img class="item-thumb" src="${escapeHtml(x.imageUrl)}" alt="${escapeHtml(x.name || "Articolo")}" />` : `<div class="item-thumb placeholder">—</div>`}
          <div>
            <b>${escapeHtml(x.name || "Articolo")}</b>
            <div class="library-meta">Gruppo ${escapeHtml(String(x.group || "B").toUpperCase())} — ${escapeHtml(x.date)}</div>
          </div>
        </div>
        <div class="library-actions">
          <button type="button" data-itemview="edit">Modifica</button>
          <button type="button" data-itemview="use">Inserisci</button>
          <button type="button" data-itemview="delete">Elimina</button>
        </div>
      </div>
    </div>
  `).join("");
}

/* ===========================
   Report helpers
=========================== */
function parseDateAny(str){
  if(!str) return null;
  // ISO
  const d1 = new Date(str);
  if(!isNaN(d1.getTime())) return d1;
  // dd/mm/yyyy hh:mm
  const m = String(str).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if(m){
    const [_, dd, mm, yyyy] = m;
    return new Date(Number(yyyy), Number(mm)-1, Number(dd));
  }
  return null;
}

function calcReport(){
  const start = ui.reportStart?.value ? new Date(ui.reportStart.value) : null;
  const end = ui.reportEnd?.value ? new Date(ui.reportEnd.value) : null;
  if(end) end.setHours(23,59,59,999);
  const statusFilter = ui.reportStatus?.value || "ALL";

  const rows = library.filter(x=>{
    const date = parseDateAny(x.date) || parseDateAny(x.state?.order?.savedAt) || null;
    if(start && date && date < start) return false;
    if(end && date && date > end) return false;
    if(statusFilter !== "ALL" && (x.status || x.state?.order?.status) !== statusFilter) return false;
    return true;
  });

  let total = 0;
  let count = rows.length;
  let paid = 0, pending = 0, draft = 0;
  const byMonth = new Map();

  rows.forEach(x=>{
    let t = Number(x.total);
    if(!Number.isFinite(t) || t === 0){
      try{
        t = quoteOrder(x.state).sums.total;
      }catch{ t = 0; }
    }
    total += t;
    const st = x.status || x.state?.order?.status || "DRAFT";
    if(st === "PAID") paid += t;
    else if(st === "PENDING") pending += t;
    else draft += t;

    const d = parseDateAny(x.date) || parseDateAny(x.state?.order?.savedAt) || null;
    if(d){
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
      byMonth.set(key, (byMonth.get(key) || 0) + t);
    }
  });

  if(ui.reportOut){
    ui.reportOut.innerHTML = `
      <div class="kpi-row">
        <div class="kpi-box"><div class="kpi-label">Totale periodo</div><div class="kpi-value">${eur(total)}</div></div>
        <div class="kpi-box"><div class="kpi-label">Numero commesse</div><div class="kpi-value">${count}</div></div>
        <div class="kpi-box"><div class="kpi-label">Media per commessa</div><div class="kpi-value">${count ? eur(total / count) : eur(0)}</div></div>
      </div>
      <div class="note" style="margin-top:8px;">
        Saldate: <b>${eur(paid)}</b> — In sospeso: <b>${eur(pending)}</b> — Da confermare: <b>${eur(draft)}</b>
      </div>
    `;
  }

  renderReportChartStatus({ paid, pending, draft });
  return { rows, total, count, paid, pending, draft, byMonth };
}

function renderReportChartStatus(statusTotals){
  if(!ui.reportChart) return;
  const ctx = ui.reportChart.getContext("2d");
  if(!ctx) return;
  const entries = [
    ["Saldate", Number(statusTotals?.paid || 0), "#10b981"],
    ["In sospeso", Number(statusTotals?.pending || 0), "#f59e0b"],
    ["Da confermare", Number(statusTotals?.draft || 0), "#94a3b8"]
  ];

  // Clear
  ctx.clearRect(0,0,ui.reportChart.width, ui.reportChart.height);
  if(entries.every(e => e[1] === 0)){
    ctx.fillStyle = "#9ca3af";
    ctx.font = "12px system-ui";
    ctx.fillText("Nessun dato", 10, 20);
    return;
  }

  const w = ui.reportChart.width;
  const h = ui.reportChart.height;
  const padding = 30;
  const barW = Math.max(30, (w - padding*2) / entries.length - 16);
  const maxVal = Math.max(...entries.map(e=>e[1])) || 1;

  ctx.strokeStyle = "#e5e7eb";
  ctx.beginPath();
  ctx.moveTo(padding, h - padding);
  ctx.lineTo(w - padding, h - padding);
  ctx.stroke();

  entries.forEach((e, i)=>{
    const label = e[0];
    const val = e[1];
    const color = e[2];
    const x = padding + i * (barW + 16);
    const barH = (h - padding*2) * (val / maxVal);
    const y = h - padding - barH;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, barW, barH);
    ctx.fillStyle = "#6b7280";
    ctx.font = "10px system-ui";
    ctx.fillText(label, x, h - 10);
  });
}

function exportReportCsv(rows){
  const sep = ";";
  const q = (v)=> `"${String(v ?? "").replace(/"/g,'""')}"`;
  const header = [
    "quote_id",
    "cliente",
    "data",
    "stato",
    "setup_mode",
    "items_count",
    "tot_materiale",
    "tot_stampa",
    "tot_design",
    "tot_sconto",
    "tot_setup",
    "tot_margine",
    "totale",
    "item_index",
    "item_nome",
    "item_gruppo",
    "item_qty",
    "item_g_per_piece",
    "item_ore_stampa",
    "item_ore_design",
    "item_totale"
  ];
  const lines = [header.map(q).join(sep)];

  rows.forEach(x=>{
    const date = x.date || x.state?.order?.savedAt || "";
    const st = x.status || x.state?.order?.status || "DRAFT";
    const setupMode = x.state?.order?.setupMode || "ORDER";
    let sums = null;
    try{ sums = quoteOrder(x.state).sums; }catch{}

    const total = sums ? sums.total : (Number.isFinite(Number(x.total)) ? Number(x.total) : 0);
    const sumMat = sums ? sums.sumMat : 0;
    const sumPrint = sums ? sums.sumPrint : 0;
    const sumDesign = sums ? sums.sumDesign : 0;
    const sumDiscount = sums ? sums.sumDiscount : 0;
    const sumSetup = sums ? sums.setupApplied : 0;
    const sumMargin = sums ? sums.sumMargin : 0;
    const items = Array.isArray(x.state?.items) ? x.state.items : [];
    const itemsCount = x.itemsCount || items.length;

    if(items.length === 0){
      const row = [
        x.quoteId || x.id,
        x.client || "",
        date,
        st,
        setupMode,
        itemsCount,
        sumMat.toFixed(2),
        sumPrint.toFixed(2),
        sumDesign.toFixed(2),
        sumDiscount.toFixed(2),
        sumSetup.toFixed(2),
        sumMargin.toFixed(2),
        total.toFixed(2),
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        ""
      ];
      lines.push(row.map(q).join(sep));
      return;
    }

    items.forEach((it, idx)=>{
      const itemQuote = quoteItem(it, x.state?.config || state.config);
      const row = [
        x.quoteId || x.id,
        x.client || "",
        date,
        st,
        setupMode,
        itemsCount,
        sumMat.toFixed(2),
        sumPrint.toFixed(2),
        sumDesign.toFixed(2),
        sumDiscount.toFixed(2),
        sumSetup.toFixed(2),
        sumMargin.toFixed(2),
        total.toFixed(2),
        idx + 1,
        it.name || "",
        (it.group || "B").toUpperCase(),
        itemQuote.qty,
        itemQuote.grams,
        itemQuote.printHours.toFixed(2),
        itemQuote.designHours.toFixed(2),
        itemQuote.itemTotal.toFixed(2)
      ];
      lines.push(row.map(q).join(sep));
    });
  });

  const csv = "\uFEFF" + lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `report_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ===========================
   Cloud sync (Supabase)
=========================== */
let cloudSupabaseClient = null;
let lastCloudConfig = { url: null, anonKey: null };

function getSupabaseClient(){
  if(!cloud.enabled) return null;
  if(!cloud.url || !cloud.anonKey) return null;
  
  // Riusa il client di autenticazione se gli URL corrispondono
  if(cloud.url === SUPABASE_URL && cloud.anonKey === SUPABASE_ANON_KEY) {
    return getAuthSupabaseClient();
  }
  
  // Se la configurazione cloud è cambiata, resetta il client
  if(lastCloudConfig.url !== cloud.url || lastCloudConfig.anonKey !== cloud.anonKey) {
    cloudSupabaseClient = null;
    lastCloudConfig = { url: cloud.url, anonKey: cloud.anonKey };
  }
  
  // Crea il client solo se non esiste
  if(!cloudSupabaseClient && window.supabase?.createClient) {
    cloudSupabaseClient = window.supabase.createClient(cloud.url, cloud.anonKey);
  }
  
  return cloudSupabaseClient;
}

async function cloudUpsertQuote(snap){
  const client = getSupabaseClient();
  if(!client) return { ok:false, error:"Cloud non configurato" };
  if(!currentUser) return { ok:false, error:"Utente non autenticato" };
  const payload = {
    quote_id: snap.quoteId || snap.id,
    user_id: currentUser.id,
    client: snap.client || snap.state?.order?.client || "Senza nome",
    payload: snap.state || snap,
    updated_at: new Date().toISOString()
  };
  const { error } = await client.from("quotes").upsert(payload, { onConflict: "quote_id" });
  return { ok: !error, error: error?.message };
}

async function cloudUpsertItem(item){
  const client = getSupabaseClient();
  if(!client) return { ok:false, error:"Cloud non configurato" };
  if(!currentUser) return { ok:false, error:"Utente non autenticato" };
  const payload = {
    item_id: item.id,
    user_id: currentUser.id,
    name: item.name,
    payload: item,
    updated_at: new Date().toISOString()
  };
  const { error } = await client.from("item_library").upsert(payload, { onConflict: "item_id" });
  return { ok: !error, error: error?.message };
}

async function cloudPullAll(){
  const client = getSupabaseClient();
  if(!client) return { ok:false, error:"Cloud non configurato" };
  if(!currentUser) return { ok:false, error:"Utente non autenticato" };
  const { data: quoteRows, error: qErr } = await client
    .from("quotes")
    .select("quote_id, client, payload, updated_at")
    .eq("user_id", currentUser.id);
  if(qErr) return { ok:false, error:qErr.message };

  const { data: itemRows, error: iErr } = await client
    .from("item_library")
    .select("item_id, name, payload, updated_at")
    .eq("user_id", currentUser.id);
  if(iErr) return { ok:false, error:iErr.message };

  library = (quoteRows || []).map(r => {
    let total = 0;
    try{ total = quoteOrder(r.payload).sums.total; }catch{}
    return {
      id: r.quote_id,
      quoteId: r.quote_id,
      client: r.client || "Senza nome",
      date: r.updated_at || nowStr(),
      itemsCount: Array.isArray(r.payload?.items) ? r.payload.items.length : 0,
      total,
      status: r.payload?.order?.status || "DRAFT",
      state: r.payload
    };
  });
  saveLibrary(library);
  renderLibrary();

  itemLibrary = (itemRows || []).map(r => ({
    ...r.payload,
    id: r.item_id,
    name: r.name || r.payload?.name || "Articolo",
    date: r.updated_at || nowStr()
  }));
  saveItemLibrary(itemLibrary);
  renderItemLibrary();

  return { ok:true };
}

async function cloudPushAll(){
  const client = getSupabaseClient();
  if(!client) return { ok:false, error:"Cloud non configurato" };
  if(!currentUser) return { ok:false, error:"Utente non autenticato" };

  for(const snap of library){
    const payload = {
      quote_id: snap.quoteId || snap.id,
      user_id: currentUser.id,
      client: snap.client,
      payload: snap.state,
      updated_at: new Date().toISOString()
    };
    const { error } = await client.from("quotes").upsert(payload, { onConflict: "quote_id" });
    if(error) return { ok:false, error:error.message };
  }

  for(const item of itemLibrary){
    const payload = {
      item_id: item.id,
      user_id: currentUser.id,
      name: item.name,
      payload: item,
      updated_at: new Date().toISOString()
    };
    const { error } = await client.from("item_library").upsert(payload, { onConflict: "item_id" });
    if(error) return { ok:false, error:error.message };
  }

  return { ok:true };
}

async function uploadItemImage(file){
  console.log(`📁 File: ${file.name} (${Math.round(file.size/1024)}KB)`);
  
  // Verifica che l'utente sia autenticato
  console.log("🔵 Verifica autenticazione...");
  
  if(!currentUser) {
    console.log("🟠 Non autenticato - uso base64");
    return fileToBase64(file);
  }
  
  console.log(`✅ User: ${currentUser.id.substring(0, 8)}...`);
  
  // Prova con client autenticato
  console.log("🔵 Ottengo client Supabase...");
  let client = getAuthSupabaseClient();
  
  if(!client){
    console.log("🟠 Client non disponibile - uso base64");
    return fileToBase64(file);
  }
  
  console.log("✅ Client OK");

  try {
    console.log("🔵 Inizio upload a Supabase Storage...");
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${currentUser.id}/${Date.now()}_${uid()}_${safeName}`;
    console.log(`📍 Path: ${path.substring(0, 40)}...`);
    
    const { data: uploadData, error } = await client.storage
      .from("item-images")
      .upload(path, file, { 
        upsert: true,
        contentType: file.type || 'image/jpeg'
      });
    
    if(error) {
      console.error("🔴 ERRORE UPLOAD!");
      console.error(`🔴 ${error.message}`);
      if(error.statusCode) console.error(`🔴 Status: ${error.statusCode}`);
      throw new Error(error.message);
    }
    
    console.log("✅ Upload completato!");
    
    const { data: urlData } = client.storage.from("item-images").getPublicUrl(path);
    const publicUrl = urlData?.publicUrl || "";
    
    if(!publicUrl) {
      console.error("🔴 URL pubblico vuoto!");
      throw new Error("URL pubblico non generato");
    }
    
    console.log(`✅ URL: ${publicUrl.substring(0, 50)}...`);
    return publicUrl;
  } catch(err) {
    console.error("🔴 ECCEZIONE!");
    console.error(`🔴 ${err.message}`);
    console.log("🟠 Fallback a base64...");
    return fileToBase64(file);
  }
}

// Helper per comprimere e convertire immagine
function compressAndConvertImage(file, maxWidth = 800, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        
        // Ridimensiona se troppo grande
        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }
        
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        // Converti in base64 compresso
        const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
        console.log("✅ Immagine compressa:", {
          originale: file.size,
          compressa: compressedBase64.length,
          riduzione: Math.round((1 - compressedBase64.length / file.size) * 100) + "%"
        });
        resolve(compressedBase64);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Helper per convertire file in base64 (ora usa compressione)
function fileToBase64(file) {
  console.log("🔄 Compressione immagine per fallback base64...");
  return compressAndConvertImage(file, 800, 0.7).catch(err => {
    console.error("❌ Errore compressione, uso base64 originale:", err);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        console.log("✅ Base64 encoded, length:", reader.result.length);
        resolve(reader.result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  });
}

/* ===========================
   Library + Backup
=========================== */
function makeSnapshot(){
  const o = quoteOrder(state);
  const s = o.sums;
  const quoteId = state.order.quoteId || generateQuoteId();
  state.order.quoteId = quoteId;
  state.order.savedAt = new Date().toISOString();
  return {
    id: quoteId,
    quoteId,
    client: state.order.client || "Senza nome",
    date: nowStr(),
    itemsCount: state.items.length,
    total: round2(s.total),
    status: state.order.status || "DRAFT",
    state: JSON.parse(JSON.stringify(state))
  };
}

function renderLibrary(){
  if(!ui.libraryList) return;
  if(!library.length){
    ui.libraryList.innerHTML = `<div class="note">Nessun preventivo salvato.</div>`;
    return;
  }

  const q = (ui.librarySearch?.value || "").trim().toLowerCase();
  const status = ui.libraryStatus?.value || "ALL";

  const filtered = library.filter(x=>{
    if(status !== "ALL" && String(x.status || "DRAFT") !== status) return false;
    if(!q) return true;
    const client = String(x.client || "").toLowerCase();
    const code = String(x.quoteId || x.id || "").toLowerCase();
    return client.includes(q) || code.includes(q);
  });

  if(!filtered.length){
    ui.libraryList.innerHTML = `<div class="note">Nessun preventivo trovato.</div>`;
    return;
  }

  ui.libraryList.innerHTML = filtered.map(x=>`
    <div class="library-item" data-id="${x.id}">
      <div class="library-head">
        <div>
          <b>${escapeHtml(x.client || "Senza nome")}</b>
          <div class="library-meta">Codice: ${escapeHtml(x.quoteId || x.id)} — ${escapeHtml(x.date)} — ${x.itemsCount} articoli — Totale: ${eur(x.total)}
            <span class="status-badge ${String(x.status||"DRAFT").toLowerCase()}">${x.status === "PAID" ? "Saldata" : x.status === "PENDING" ? "In sospeso" : "Da confermare"}</span>
          </div>
        </div>
        <div class="library-actions">
          <button type="button" data-lib="load">Carica</button>
          <button type="button" data-lib="delete">Elimina</button>
        </div>
      </div>
    </div>
  `).join("");
}

function buildBackupPayload(){
  return {
    version: 1,
    date: nowStr(),
    state,
    library,
    itemLibrary
  };
}

function downloadBackup(){
  const payload = buildBackupPayload();
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `preventivatore3d_backup_${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ===========================
   Render (UI + fixes)
=========================== */
function render(){
  const o = quoteOrder(state);
  const s = o.sums;

  ui.total.textContent = eur(s.total);
  ui.noteKpi.textContent = `${state.items.length} articoli — setup ${state.order.setupMode==="ITEM" ? "per articolo" : "per commessa"}`;

  ui.sumMat.textContent = eur(s.sumMat);
  ui.sumPrint.textContent = eur(s.sumPrint);
  ui.sumDesign.textContent = eur(s.sumDesign);
  ui.sumPostProcess.textContent = eur(s.sumPostProcess);
  ui.sumDiscount.textContent = "- " + eur(s.sumDiscount);
  ui.sumSetup.textContent = eur(s.setupApplied);
  ui.sumMargin.textContent = eur(s.sumMargin);
  ui.sumTotal.textContent = eur(s.total);

  const anyDiscount = s.sumDiscount > 0;
  
  // Validazioni globali
  const hasAnyZeroPrintHours = state.items.some(it => parseHoursSmart(it.printHoursPerPiece, 0) === 0);
  const hasAnyZeroDesignHours = state.items.some(it => it.hasDesign !== false && parseHoursSmart(it.designHours, 0) === 0);
  
  const warningsGlobal = [];
  if (hasAnyZeroPrintHours) warningsGlobal.push(`<span class="warn">⚠ Ore stampa a 0 in almeno un articolo. Inserisci un valore (es. 0:40).</span>`);
  if (hasAnyZeroDesignHours) warningsGlobal.push(`<span class="warn">⚠ Design=SI ma ore=0 in almeno un articolo. Se il file è pronto imposta Design=NO.</span>`);
  const warnGlobalHTML = warningsGlobal.length > 0 ? `<br>${warningsGlobal.join("<br>")}` : "";
  
  ui.note.innerHTML = `
    Cliente: <b>${escapeHtml(state.order.client || "—")}</b>.
    ${anyDiscount ? `<span class="warn">Sconto serie applicato su almeno un articolo.</span>` : `Nessuno sconto serie applicato.`}
    <br>
    <span class="mini">Tip: scrivi ore come <b>1:30</b> o <b>1.30</b> (1h30), non 1,30 ore.</span>
    ${warnGlobalHTML}
  `;

  // per-item output + correct labels based on DOM
  o.itemQuotes.forEach(x=>{
    const wrap = ui.items.querySelector(`.item[data-id="${x.id}"]`);
    if(!wrap) return;

    const out = wrap.querySelector(`[data-out="rowResult"]`);
    const q = x.q;
    const raw = x.raw;

    // Read directly from DOM to avoid stale text
    const uiHasDesign = wrap.querySelector(`[data-k="hasDesign"]`)?.checked ?? (raw.hasDesign !== false);
    const uiIsSeries = wrap.querySelector(`[data-k="isSeries"]`)?.checked ?? (raw.isSeries === true);
    const uiMatOverride = wrap.querySelector(`[data-k="materialOverrideOn"]`)?.checked ?? (raw.materialOverrideOn === true);

    // enable/disable
    const inDesign = wrap.querySelector(`[data-k="designHours"]`);
    const inMat = wrap.querySelector(`[data-k="materialEurPerGram"]`);
    if(inDesign) inDesign.disabled = !uiHasDesign;
    if(inMat) inMat.disabled = !uiMatOverride;

    // update label texts
    const lblDesign = wrap.querySelector(`[data-k-label="hasDesign"]`);
    const lblSeries = wrap.querySelector(`[data-k-label="isSeries"]`);
    const lblMat = wrap.querySelector(`[data-k-label="matOverride"]`);
    if(lblDesign) lblDesign.textContent = uiHasDesign ? "SI" : "NO (file pronto)";
    if(lblSeries) lblSeries.textContent = uiIsSeries ? "SI" : "NO";
    if(lblMat) lblMat.textContent = uiMatOverride ? "ON" : "USA DEFAULT";

    const g = state.config.groups[q.groupKey];

    // Validazioni leggere
    let validations = [];
    if (uiHasDesign && q.designHours === 0) {
      validations.push(`<span class="warn">⚠ Design=SI ma ore=0 → costo design 0€. Se il file è pronto, imposta Design=NO.</span>`);
    }
    if (q.printHours === 0) {
      validations.push(`<span class="warn">⚠ Ore stampa=0 → il costo stampa è 0€</span>`);
    }
    if (q.qty === 0) {
      validations.push(`<span class="warn">⚠ Quantità=0 → riga non valorizzata</span>`);
    }
    const validationHTML = validations.length > 0 ? `<div style="margin-top:8px;">${validations.join("<br>")}</div>` : "";

    out.innerHTML = `
      <b>${escapeHtml(raw.name || "Articolo")}</b> —
      <span class="chip">Gruppo <b>${q.groupKey}</b> (stampa×${fmtComma(g.printFactor)} · design×${fmtComma(g.designFactor)} · marg ${Math.round(g.marginPct*100)}%)</span>
      <br>
      Materiale: ${eur(q.materialCost)} — Stampa: ${eur(q.printCost)} — Design: ${eur(q.designCost)}
      ${q.seriesDiscount > 0 ? ` — <span class="warn">Sconto: -${eur(q.seriesDiscount)}</span>` : ` — Sconto: ${eur(0)}`}
      <br>
      Prezzo unitario: <b>${eur(q.unitPrice)}</b> — Totale riga: <b>${eur(q.itemTotal)}</b>
      <span class="mini"> (qty=${q.qty}, g/pezzo=${q.grams}, stampa=${round2(q.printHours)}h, design=${round2(q.designHours)}h)</span>
      ${validationHTML}
    `;
  });
}

function recalcAndSave(){
  readTop();
  readItemsFromDOM();
  saveState(state);
  syncItemSummaries();
  render();
}

/* ===========================
   PDF export (print)
=========================== */
function buildPrint() {
  const o = quoteOrder(state);
  const s = o.sums;
  const pdf = { ...DEFAULTS.config.pdf, ...(state.config.pdf || {}) };

  ui.printMeta.textContent =
    `Cliente: ${state.order.client || "—"} — Data: ${nowStr()} — Setup: ${state.order.setupMode==="ITEM" ? "per articolo" : "per commessa"} — Articoli: ${state.items.length}`;

  const cols = [
    { label: "Articolo", className: "", render: (x)=> escapeHtml(x.raw.name || "Articolo") },
    { label: "Gruppo", className: "", render: (x)=> x.q.groupKey },
    { label: "Q.tà", className: "num", render: (x)=> x.q.qty },
  ];
  if(pdf.showGrams) cols.push({ label: "g/pezzo", className: "num", render: (x)=> round2(x.q.grams) });
  if(pdf.showHours){
    cols.push({ label: "Stampa (h/pezzo)", className: "num", render: (x)=> round2(x.q.printHours) });
    cols.push({ label: "Design (h tot)", className: "num", render: (x)=> round2(x.q.designHours) });
  }
  cols.push({ label: "Prezzo unit.", className: "num", render: (x)=> eur(x.q.unitPrice) });
  cols.push({ label: "Totale riga", className: "num", render: (x)=> eur(x.q.itemTotal) });

  if(ui.printHead){
    ui.printHead.innerHTML = cols.map(c=>`<th${c.className?` class="${c.className}"`:""}>${c.label}</th>`).join("");
  }

  ui.printItems.innerHTML = o.itemQuotes.map(x=>{
    return `<tr>${cols.map(c=>`<td${c.className?` class="${c.className}"`:""}>${c.render(x)}</td>`).join("")}</tr>`;
  }).join("");

  const postLines = o.itemQuotes.map(x=>{
    const notes = (x.raw?.postProcessNotes || "").trim();
    const extras = Array.isArray(x.raw?.postProcessExtras) ? x.raw.postProcessExtras : [];
    if(!notes && extras.length === 0) return "";
    const extrasText = extras.length
      ? extras.map(ex => `${escapeHtml(ex?.name || "Extra")}: ${eur(num(ex?.price, 0))}`).join(", ")
      : "";
    return `
      <div style="margin-bottom:8px;">
        <b>${escapeHtml(x.raw?.name || "Articolo")}</b>
        ${notes ? `<div>${escapeHtml(notes)}</div>` : ""}
        ${extrasText ? `<div class=\"mini\">Extra: ${extrasText}</div>` : ""}
      </div>
    `;
  }).filter(Boolean).join("");

  if(ui.printPostProcessBox && ui.printPostProcessList){
    if(postLines){
      ui.printPostProcessBox.style.display = "";
      ui.printPostProcessList.innerHTML = postLines;
    } else {
      ui.printPostProcessBox.style.display = "none";
      ui.printPostProcessList.innerHTML = "";
    }
  }

  // Calcola totali per la riga di riepilogo
  let totalQty = 0;
  let totalGrams = 0;
  let totalPrintHours = 0;
  let totalDesignHours = 0;
  let totalPrice = 0;

  o.itemQuotes.forEach(x => {
    totalQty += x.q.qty;
    totalGrams += x.q.grams * x.q.qty;
    totalPrintHours += x.q.printHours * x.q.qty;
    totalDesignHours += x.q.designHours;
    totalPrice += x.q.itemTotal;
  });

  // Aggiungi riga totali
  if(ui.printItemsTotals){
    const totalCells = [];
    totalCells.push(`<td colspan="2" style="font-weight:600; text-align:right;">TOTALI</td>`);
    totalCells.push(`<td class="num" style="font-weight:600;">${totalQty}</td>`);
    if(pdf.showGrams) totalCells.push(`<td class="num" style="font-weight:600;">${round2(totalGrams)}</td>`);
    if(pdf.showHours){
      totalCells.push(`<td class="num" style="font-weight:600;">${round2(totalPrintHours)}</td>`);
      totalCells.push(`<td class="num" style="font-weight:600;">${round2(totalDesignHours)}</td>`);
    }
    totalCells.push(`<td class="num"></td>`); // Prezzo unitario vuoto
    totalCells.push(`<td class="num" style="font-weight:600;">${eur(totalPrice)}</td>`);
    ui.printItemsTotals.innerHTML = `<tr style="border-top: 2px solid #333;">${totalCells.join("")}</tr>`;
  }

  ui.p_sumMat.textContent = eur(s.sumMat);
  ui.p_sumPrint.textContent = eur(s.sumPrint);
  ui.p_sumDesign.textContent = eur(s.sumDesign);
  ui.p_sumPostProcess.textContent = eur(s.sumPostProcess);
  ui.p_sumDiscount.textContent = "- " + eur(s.sumDiscount);
  ui.p_sumSetup.textContent = eur(s.setupApplied);
  ui.p_sumMargin.textContent = eur(s.sumMargin);
  if(ui.p_rowPostProcess) ui.p_rowPostProcess.style.display = s.sumPostProcess > 0 ? "" : "none";
  if(ui.p_rowDiscount) ui.p_rowDiscount.style.display = pdf.showDiscount ? "" : "none";
  if(ui.p_rowSetup) ui.p_rowSetup.style.display = pdf.showSetup ? "" : "none";
  if(ui.p_rowMargin) ui.p_rowMargin.style.display = pdf.showMargin ? "" : "none";
  ui.p_total.textContent = eur(s.total);

  if(pdf.showBaseCosts){
    ui.printFoot.textContent = `Costi base: materiale ${fmtComma(state.config.materialEurPerGram)} €/g — macchina ${fmtComma(state.config.machineEurPerHour)} €/h — design ${fmtComma(state.config.designEurPerHour)} €/h — post-produzione ${fmtComma(state.config.postProcessEurPerHour || 15)} €/h — setup ${fmtComma(state.config.machineSetupFee)} € — sconto serie ${Math.round(state.config.seriesDiscountPct*100)}% (soglia ${state.config.seriesThresholdQty}).`;
    ui.printFoot.style.display = "";
  }else{
    ui.printFoot.textContent = "";
    ui.printFoot.style.display = "none";
  }
}

/* ===========================
   Events
=========================== */
ui.addItem.addEventListener("click", ()=>{
  state.items.push({
    id: uid(),
    name: "",
    imageUrl: "",
    group: "B",
    qty: "",
    gramsPerPiece: "",
    printHoursPerPiece: "",
    hasDesign: false,
    designHours: "",
    postProcessHours: "",
    postProcessNotes: "",
    postProcessExtras: [],
    isSeries: false,
    materialOverrideOn: false,
    materialEurPerGram: state.config.materialEurPerGram
  });
  saveState(state);
  renderItems();
  render();
});

ui.reset.addEventListener("click", ()=>{
  localStorage.removeItem(STORAGE_KEY);
  state = structuredClone(DEFAULTS);
  saveState(state);
  bindTop();
  renderItems();
  render();
});

ui.exportPdf.addEventListener("click", ()=>{
  // ensure latest values are in state
  recalcAndSave();
  buildPrint();
  // Print dialog -> user can Save as PDF
  window.print();
});

ui.copy.addEventListener("click", async ()=>{
  const o = quoteOrder(state);
  const s = o.sums;

  const lines = [];
  lines.push(`Price3D — Cliente: ${state.order.client || "-"}`);
  lines.push(`Data: ${nowStr()}`);
  lines.push(`Setup: ${state.order.setupMode === "ITEM" ? "per articolo" : "per commessa"} (${round2(s.setupApplied)}€)`);
  lines.push(`Articoli:`);

  o.itemQuotes.forEach(x=>{
    const q = x.q;
    const name = x.raw.name || "Articolo";
    lines.push(`- [${q.groupKey}] ${name}: qty ${q.qty}, unit ${round2(q.unitPrice)}€, riga ${round2(q.itemTotal)}€ (mat ${round2(q.materialCost)}€, stampa ${round2(q.printCost)}€, design ${round2(q.designCost)}€, sconto ${round2(q.seriesDiscount)}€, marg ${Math.round(q.marginPct*100)}%)`);
  });

  lines.push(`Totale materiale: ${round2(s.sumMat)}€`);
  lines.push(`Totale stampa: ${round2(s.sumPrint)}€`);
  lines.push(`Totale design: ${round2(s.sumDesign)}€`);
  lines.push(`Totale post-produzione: ${round2(s.sumPostProcess)}€`);
  lines.push(`Sconto serie totale: ${round2(s.sumDiscount)}€`);
  lines.push(`Margine totale: ${round2(s.sumMargin)}€`);
  lines.push(`TOTALE FINALE: ${round2(s.total)}€`);

  const text = lines.join("\n");
  try{
    await navigator.clipboard.writeText(text);
    ui.note.innerHTML = `<span class="ok">Riepilogo copiato negli appunti.</span>`;
  }catch{
    ui.note.innerHTML = `<span class="warn">Copia automatica non disponibile. Copia manualmente:</span><pre style="white-space:pre-wrap">${text}</pre>`;
  }
});

// Library actions
if(ui.saveQuote){
  ui.saveQuote.addEventListener("click", async ()=>{
    recalcAndSave();
    const snap = makeSnapshot();
    const existingIdx = library.findIndex(x => (x.quoteId || x.id) === snap.quoteId);
    if(existingIdx >= 0){
      library[existingIdx] = snap;
    } else {
      library.unshift(snap);
    }
    saveLibrary(library);
    renderLibrary();
    bindTop();
    ui.note.innerHTML = `<span class="ok">Preventivo salvato in libreria.</span>`;
    
    // Auto-sync to Supabase if user is logged in
    console.log("🔵 Checking auto-sync, currentUser:", currentUser);
    if (currentUser) {
      console.log("🟢 User logged in, calling supabaseUpsertQuote...");
      const result = await supabaseUpsertQuote(snap);
      console.log("🟡 Upsert result:", result);
      if (!result.ok) {
        ui.note.innerHTML += ` <span class="warn">Errore cloud: ${result.error}</span>`;
      } else {
        ui.note.innerHTML += ` <span style="color: var(--success);">✓ Sincronizzato al cloud</span>`;
      }
    } else {
      console.log("🔴 No currentUser - sync skipped");
    }

    // Auto-reset commessa dopo salvataggio (mantiene le impostazioni)
    state = {
      ...state,
      order: structuredClone(DEFAULTS.order),
      items: structuredClone(DEFAULTS.items)
    };
    saveState(state);
    bindTop();
    renderItems();
    render();
  });
}

if(ui.saveCopy){
  ui.saveCopy.addEventListener("click", ()=>{
    recalcAndSave();
    // force new quote id
    state.order.quoteId = generateQuoteId();
    const snap = makeSnapshot();
    library.unshift(snap);
    saveLibrary(library);
    renderLibrary();
    bindTop();
    ui.note.innerHTML = `<span class="ok">Copia creata come nuovo preventivo.</span>`;
    if(cloud.enabled){
      cloudUpsertQuote(snap).then(res=>{
        if(!res.ok && ui.cloudStatus) ui.cloudStatus.textContent = `Cloud: ${res.error}`;
      });
    }
  });
}

// Backup modal
if(ui.openBackup && ui.backupModal){
  const openModal = ()=>{
    ui.backupModal.classList.add("open");
    ui.backupModal.setAttribute("aria-hidden", "false");
  };
  const closeModal = ()=>{
    ui.backupModal.classList.remove("open");
    ui.backupModal.setAttribute("aria-hidden", "true");
  };

  ui.openBackup.addEventListener("click", openModal);
  ui.closeBackup?.addEventListener("click", closeModal);
  ui.backupModal.addEventListener("click", (e)=>{
    if(e.target.matches("[data-close='backup']")) closeModal();
  });
  document.addEventListener("keydown", (e)=>{
    if(e.key === "Escape") closeModal();
  });
}

// Item library modal
if(ui.itemLibraryModal){
  ui.closeItemLibrary?.addEventListener("click", closeItemLibrary);
  ui.itemLibraryModal.addEventListener("click", (e)=>{
    if(e.target.matches("[data-close='itemlib']")) closeItemLibrary();
  });
  ui.itemSearch?.addEventListener("input", renderItemLibrary);

  ui.itemLibraryList?.addEventListener("click", (e)=>{
    const btn = e.target.closest("button[data-itemlib]");
    if(!btn) return;
    const wrap = e.target.closest(".library-item");
    const id = wrap?.getAttribute("data-id");
    const entry = itemLibrary.find(x=>x.id===id);
    if(!entry) return;
    const action = btn.getAttribute("data-itemlib");

    if(action === "delete"){
      if(!confirm("Eliminare questo articolo dallo storico?")) return;
      itemLibrary = itemLibrary.filter(x=>x.id!==id);
      saveItemLibrary(itemLibrary);
      renderItemLibrary();
      
      // Delete from Supabase
      if (currentUser) {
        supabaseDeleteItem(id).then(result => {
          if (!result.ok) {
            console.warn("Errore eliminazione articolo cloud:", result.error);
          }
        });
      }
      return;
    }

    if(action === "use"){
      readItemsFromDOM();
      const idx = state.items.findIndex(x=>x.id===currentItemTargetId);
      if(idx === -1) return;
      state.items[idx] = {
        ...state.items[idx],
        name: entry.name,
        imageUrl: entry.imageUrl || "",
        group: entry.group,
        gramsPerPiece: entry.gramsPerPiece,
        printHoursPerPiece: entry.printHoursPerPiece,
        hasDesign: entry.hasDesign,
        designHours: entry.designHours,
        isSeries: entry.isSeries,
        materialOverrideOn: entry.materialOverrideOn,
        materialEurPerGram: entry.materialEurPerGram
      };
      saveState(state);
      renderItems();
      render();
      closeItemLibrary();
    }
  });
}

// Items view
if(ui.itemsListView){
  ui.itemsListView.addEventListener("click", (e)=>{
    const btn = e.target.closest("button[data-itemview]");
    if(!btn) return;
    const wrap = e.target.closest(".library-item");
    const id = wrap?.getAttribute("data-id");
    const entry = itemLibrary.find(x=>x.id===id);
    if(!entry) return;
    const action = btn.getAttribute("data-itemview");

    if(action === "delete"){
      if(!confirm("Eliminare questo articolo?")) return;
      itemLibrary = itemLibrary.filter(x=>x.id!==id);
      saveItemLibrary(itemLibrary);
      renderItemsView();
      
      // Delete from Supabase
      if (currentUser) {
        supabaseDeleteItem(id).then(result => {
          if (!result.ok) {
            console.warn("Errore eliminazione articolo cloud:", result.error);
          }
        });
      }
      return;
    }

    if(action === "edit"){
      loadItemEditForm(id);
      const accordion = document.getElementById("itemEditAccordion");
      if(accordion) accordion.setAttribute("open", "");
      return;
    }

    if(action === "use"){
      readItemsFromDOM();
      state.items.push({
        id: uid(),
        name: entry.name,
        imageUrl: entry.imageUrl || "",
        group: entry.group,
        qty: "",
        gramsPerPiece: entry.gramsPerPiece,
        printHoursPerPiece: entry.printHoursPerPiece,
        hasDesign: entry.hasDesign,
        designHours: entry.designHours,
        isSeries: entry.isSeries,
        materialOverrideOn: entry.materialOverrideOn,
        materialEurPerGram: entry.materialEurPerGram
      });
      saveState(state);
      renderItems();
      render();
      ui.note.innerHTML = `<span class="ok">Articolo aggiunto alla commessa.</span>`;
      setView("main");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  });
}

if(ui.itemEditMaterialOverride){
  ui.itemEditMaterialOverride.addEventListener("change", ()=>{
    if(ui.itemEditMaterialField) ui.itemEditMaterialField.style.display = ui.itemEditMaterialOverride.checked ? "" : "none";
  });
}

// Funzione comune per gestire l'upload
const handleImageUpload = (file, source) => {

  
  if(!file) {

    ui.note.innerHTML = `<span class="warn">❌ Nessun file selezionato</span>`;
    return;
  }
  

  
  // Verifica dimensione file (max 5MB)
  if(file.size > 5 * 1024 * 1024) {

    ui.note.innerHTML = `<span class="warn">❌ File troppo grande (max 5MB)</span>`;
    return;
  }
  
  ui.note.innerHTML = `<span class="mini">⏳ Caricamento ${Math.round(file.size/1024)}KB...</span>`;
  
  // Mostra preview immediata
  if(ui.itemImagePreview && ui.itemImagePreviewImg) {
    const reader = new FileReader();
    reader.onload = (e) => {
      ui.itemImagePreviewImg.src = e.target.result;
      ui.itemImagePreview.style.display = 'block';

    };
    reader.readAsDataURL(file);
  }
  

  
  uploadItemImage(file).then((url)=>{


    
    if(ui.itemEditImageUrl) {
      ui.itemEditImageUrl.value = url;

    } else {

    }
    
    ui.note.innerHTML = `<span class="ok">✓ Immagine pronta! Clicca "Salva articolo".</span>`;
  }).catch((err)=>{


    ui.note.innerHTML = `<span class="warn">❌ Errore: ${escapeHtml(err.message || "Upload fallito")}</span>`;
    if(ui.itemImagePreview) ui.itemImagePreview.style.display = 'none';
  });
};

if(ui.itemEditImageFile){
  ui.itemEditImageFile.addEventListener("change", (e)=>{

    const file = e.target.files?.[0];
    handleImageUpload(file, "galleria");
    e.target.value = ""; // Reset per permettere stessa foto
  });
}

if(ui.itemEditCameraCapture){
  ui.itemEditCameraCapture.addEventListener("change", (e)=>{

    const file = e.target.files?.[0];
    handleImageUpload(file, "fotocamera");
    e.target.value = ""; // Reset per permettere stessa foto
  });
}

if(ui.itemEditGalleryBtn){
  ui.itemEditGalleryBtn.addEventListener("click", (e)=>{
    e.preventDefault();
    


    
    if(ui.itemEditImageFile) {


      ui.itemEditImageFile.click();
    } else {

      alert("ERRORE: Input file non trovato!");
    }
  });
}

if(ui.itemEditCameraBtn){
  ui.itemEditCameraBtn.addEventListener("click", (e)=>{
    e.preventDefault();
    


    
    if(ui.itemEditCameraCapture) {


      ui.itemEditCameraCapture.click();
    } else {

      alert("ERRORE: Input camera non trovato!");
    }
  });
}

if(ui.itemEditSave){
  ui.itemEditSave.addEventListener("click", ()=>{
    console.log("🔴🔴🔴 CLICK SALVA ARTICOLO HANDLER TRIGGERED 🔴🔴🔴");

    
    const name = ui.itemEditName?.value?.trim();
    if(!name){

      ui.note.innerHTML = `<span class="warn">Inserisci un nome per l'articolo.</span>`;
      return;
    }

    const imageUrl = ui.itemEditImageUrl?.value?.trim() || "";

    if(imageUrl.length > 0) {

    }
    
    const newItem = {
      id: currentEditItemId || uid(),
      name: name,
      imageUrl: imageUrl,
      group: ui.itemEditGroup?.value || "B",
      date: nowStr(),
      gramsPerPiece: num(ui.itemEditGrams?.value || ""),
      printHoursPerPiece: (ui.itemEditPrintHours?.value || "").trim(),
      designHours: num(ui.itemEditDesignHours?.value || ""),
      hasDesign: ui.itemEditHasDesign?.checked !== false,
      isSeries: ui.itemEditIsSeries?.checked === true,
      materialOverrideOn: ui.itemEditMaterialOverride?.checked === true,
      materialEurPerGram: num(ui.itemEditMaterialCost?.value || state.config.materialEurPerGram)
    };
    
    console.log("📦 Oggetto newItem creato:", {
      id: newItem.id,
      name: newItem.name,
      imageUrl: newItem.imageUrl.substring(0, 50) + "...",
      imageUrlLength: newItem.imageUrl.length
    });


    
    if(currentEditItemId){
      const idx = itemLibrary.findIndex(x=>x.id===currentEditItemId);
      if(idx !== -1){
        itemLibrary[idx] = newItem;

        ui.note.innerHTML = `<span class="ok">Articolo aggiornato.</span>`;
      }
    }else{
      itemLibrary.unshift(newItem);

      ui.note.innerHTML = `<span class="ok">Articolo creato.</span>`;
    }

    saveItemLibrary(itemLibrary);


    // Auto-sync to Supabase if user is logged in

    if (currentUser) {

      supabaseUpsertItem(newItem).then(result => {

        if (!result.ok) {

          ui.note.innerHTML += ` <span class="warn">Errore cloud: ${result.error}</span>`;
        } else {

          ui.note.innerHTML += ` <span style="color: var(--success);">✓ Sincronizzato al cloud</span>`;
        }
      }).catch(err => {

      });
    } else {

      if (cloud.enabled) {

        cloudUpsertItem(newItem).then(res=>{
          if (!res.ok && ui.cloudStatus) ui.cloudStatus.textContent = `Cloud: ${res.error}`;
        });
      }
    }

    clearItemEditForm();
    renderItemsView();
  });
}

if(ui.itemEditCancel){
  ui.itemEditCancel.addEventListener("click", ()=>{
    clearItemEditForm();
  });
}

if(ui.itemsSearch){
  ui.itemsSearch.addEventListener("input", ()=>{
    renderItemsView();
  });
}
if(ui.itemsGroup){
  ui.itemsGroup.addEventListener("change", ()=>{
    renderItemsView();
  });
}

if(ui.clearLibrary){
  ui.clearLibrary.addEventListener("click", ()=>{
    if(!confirm("Vuoi svuotare tutta la libreria?")) return;
    library = [];
    saveLibrary(library);
    renderLibrary();
  });
}

if(ui.libraryList){
  ui.libraryList.addEventListener("click", (e)=>{
    const btn = e.target.closest("button[data-lib]");
    if(!btn) return;
    const wrap = e.target.closest(".library-item");
    const id = wrap?.getAttribute("data-id");
    const entry = library.find(x=>x.id===id);
    if(!entry) return;
    const action = btn.getAttribute("data-lib");
    if(action === "load"){
      state = JSON.parse(JSON.stringify(entry.state));
      state.order.quoteId = entry.quoteId || entry.id;
      saveState(state);
      bindTop();
      renderItems();
      render();
      ui.note.innerHTML = `<span class="ok">Preventivo caricato dalla libreria.</span>`;
      setView("main");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    if(action === "delete"){
      if(!confirm("Eliminare questo preventivo?")) return;
      library = library.filter(x=>x.id!==id);
      saveLibrary(library);
      renderLibrary();
      
      // Delete from Supabase
      if (currentUser) {
        supabaseDeleteQuote(id).then(result => {
          if (!result.ok) {
            console.warn("Errore eliminazione cloud:", result.error);
          }
        });
      }
    }
  });
}

if(ui.librarySearch){
  ui.librarySearch.addEventListener("input", ()=>{
    renderLibrary();
  });
}
if(ui.libraryStatus){
  ui.libraryStatus.addEventListener("change", ()=>{
    renderLibrary();
  });
}

// Backup actions
if(ui.exportBackup){
  ui.exportBackup.addEventListener("click", ()=>{
    recalcAndSave();
    const json = JSON.stringify(buildBackupPayload(), null, 2);
    if(ui.backupText) ui.backupText.value = json;
    downloadBackup();
  });
}

if(ui.copyBackup){
  ui.copyBackup.addEventListener("click", async ()=>{
    const json = JSON.stringify(buildBackupPayload(), null, 2);
    if(ui.backupText) ui.backupText.value = json;
    try{
      await navigator.clipboard.writeText(json);
      ui.note.innerHTML = `<span class="ok">Backup copiato negli appunti.</span>`;
    }catch{
      ui.note.innerHTML = `<span class="warn">Copia non disponibile. Usa il box sopra.</span>`;
    }
  });
}

if(ui.importBackup){
  ui.importBackup.addEventListener("click", ()=>{
    const raw = ui.backupText?.value?.trim();
    if(!raw){
      ui.note.innerHTML = `<span class="warn">Incolla un JSON valido nel box.</span>`;
      return;
    }
    try{
      const payload = JSON.parse(raw);
      if(Array.isArray(payload.library)){
        library = payload.library;
        saveLibrary(library);
      }
      if(Array.isArray(payload.itemLibrary)){
        itemLibrary = payload.itemLibrary;
        saveItemLibrary(itemLibrary);
      }
      if(payload.state){
        state = payload.state;
        if(!state.order.quoteId){
          state.order.quoteId = generateQuoteId();
        }
        saveState(state);
        bindTop();
        renderItems();
        render();
      }
      renderLibrary();
      renderItemLibrary();
      ui.note.innerHTML = `<span class="ok">Backup importato con successo.</span>`;
    }catch{
      ui.note.innerHTML = `<span class="warn">JSON non valido.</span>`;
    }
  });
}

// Cloud settings/actions
if(ui.cloudSave){
  ui.cloudSave.addEventListener("click", ()=>{
    cloud = {
      enabled: !!ui.cloudEnabled?.checked,
      url: ui.cloudUrl?.value?.trim() || "",
      anonKey: ui.cloudKey?.value?.trim() || ""
    };
    saveCloudSettings(cloud);
    bindTop();
    if(ui.cloudStatus){
      ui.cloudStatus.textContent = cloud.enabled ? "Cloud attivo." : "Cloud disattivato.";
    }
  });
}

if(ui.cloudPull){
  ui.cloudPull.addEventListener("click", async ()=>{
    if(ui.cloudStatus) ui.cloudStatus.textContent = "Sincronizzazione in corso...";
    const res = await cloudPullAll();
    if(ui.cloudStatus){
      ui.cloudStatus.textContent = res.ok ? "Cloud: dati scaricati." : `Cloud: ${res.error}`;
    }
  });
}

if(ui.cloudPush){
  ui.cloudPush.addEventListener("click", async ()=>{
    if(ui.cloudStatus) ui.cloudStatus.textContent = "Sincronizzazione in corso...";
    const res = await cloudPushAll();
    if(ui.cloudStatus){
      ui.cloudStatus.textContent = res.ok ? "Cloud: dati inviati." : `Cloud: ${res.error}`;
    }
  });
}

if(ui.reportPreset){
  ui.reportPreset.addEventListener("change", ()=>{
    const val = ui.reportPreset.value;
    const now = new Date();
    let start = null;
    if(val === "WEEK") start = new Date(now.getTime() - 7*24*60*60*1000);
    if(val === "MONTH") start = new Date(now.getTime() - 30*24*60*60*1000);
    if(val === "SEMESTER") start = new Date(now.getTime() - 182*24*60*60*1000);
    if(val === "YEAR") start = new Date(now.getTime() - 365*24*60*60*1000);
    if(start){
      ui.reportStart.value = start.toISOString().slice(0,10);
      ui.reportEnd.value = now.toISOString().slice(0,10);
    }
  });
}

if(ui.reportCalc){
  ui.reportCalc.addEventListener("click", calcReport);
}

if(ui.reportMonth){
  ui.reportMonth.addEventListener("click", ()=>{
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth()+1, 0);
    ui.reportStart.value = start.toISOString().slice(0,10);
    ui.reportEnd.value = end.toISOString().slice(0,10);
    calcReport();
  });
}

if(ui.reportYear){
  ui.reportYear.addEventListener("click", ()=>{
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 1);
    const end = new Date(now.getFullYear(), 11, 31);
    ui.reportStart.value = start.toISOString().slice(0,10);
    ui.reportEnd.value = end.toISOString().slice(0,10);
    calcReport();
  });
}

if(ui.reportCsv){
  ui.reportCsv.addEventListener("click", ()=>{
    const res = calcReport();
    exportReportCsv(res.rows);
  });
}

// Menu + views
ui.openMenu?.addEventListener("click", openMenu);
ui.closeMenu?.addEventListener("click", closeMenu);
ui.menuOverlay?.addEventListener("click", closeMenu);
document.addEventListener("click", (e)=>{
  const btn = e.target.closest("[data-view]");
  if(!btn) return;
  const view = btn.getAttribute("data-view");
  setView(view);
});

// Theme
if(ui.themeSelect){
  ui.themeSelect.addEventListener("change", ()=>{
    applyTheme(ui.themeSelect.value);
  });
}

// Global listeners (top config)
document.addEventListener("input", (e)=>{
  if(e.target.matches("#client,#setupMode,#cfg_material,#cfg_machine,#cfg_design,#cfg_postProcess,#cfg_setup,#cfg_discount,#cfg_threshold,#gA_print,#gA_design,#gA_margin,#gB_print,#gB_design,#gB_margin,#gC_print,#gC_design,#gC_margin,#pdfShowGrams,#pdfShowHours,#pdfShowSetup,#pdfShowDiscount,#pdfShowMargin,#pdfShowBaseCosts")){
    recalcAndSave();
  }
});
document.addEventListener("change", (e)=>{
  if(e.target.matches("#client,#setupMode,#cfg_material,#cfg_machine,#cfg_design,#cfg_postProcess,#cfg_setup,#cfg_discount,#cfg_threshold,#gA_print,#gA_design,#gA_margin,#gB_print,#gB_design,#gB_margin,#gC_print,#gC_design,#gC_margin,#pdfShowGrams,#pdfShowHours,#pdfShowSetup,#pdfShowDiscount,#pdfShowMargin,#pdfShowBaseCosts")){
    recalcAndSave();
  }
});

// Delegate item inputs
ui.items.addEventListener("input", (e)=>{
  if(e.target.matches("input,select")) recalcAndSave();
});
ui.items.addEventListener("change", (e)=>{
  if(e.target.matches("input,select")) recalcAndSave();
});
ui.items.addEventListener("click", (e)=>{
  const btn = e.target.closest("button[data-act]");
  if(!btn) return;
  const wrap = e.target.closest(".item");
  const id = wrap.getAttribute("data-id");
  const action = btn.getAttribute("data-act");
  if(action === "remove"){
    state.items = state.items.filter(x=>x.id!==id);
    saveState(state);
    renderItems();
    render();
    return;
  }
  if(action === "addExtra"){
    const wrapItem = e.target.closest(".item");
    const extrasList = wrapItem?.querySelector("[data-k=\"postProcessExtras\"]");
    if(extrasList){
      const row = document.createElement("div");
      row.className = "extras-row";
      row.setAttribute("data-extra-row", "");
      row.innerHTML = `
        <input data-extra-name type="text" placeholder="Nome extra" />
        <input data-extra-price type="text" inputmode="decimal" placeholder="Prezzo" />
        <button type="button" class="extras-remove" data-act="removeExtra" title="Rimuovi">−</button>
      `;
      extrasList.appendChild(row);
    }
    return;
  }
  if(action === "removeExtra"){
    const row = e.target.closest("[data-extra-row]");
    if(row) row.remove();
    readItemsFromDOM();
    saveState(state);
    render();
    return;
  }
  if(action === "saveItem"){
    readItemsFromDOM();
    const found = state.items.find(x=>x.id===id);
    if(!found) return;
    
    ui.note.innerHTML = `<span class="mini">Salvataggio articolo...</span>`;
    
    // Se l'immagine è ancora base64 (locale), caricala a Supabase PRIMA di salvare
    const imageUrl = found.imageUrl;
    const isBase64 = imageUrl && imageUrl.startsWith('data:');
    
    const processAndSave = async () => {
      let finalImageUrl = imageUrl;
      
      if(isBase64) {
        // Convertì base64 a blob e carica a Supabase
        try {
          const blob = await fetch(imageUrl).then(r => r.blob());
          finalImageUrl = await uploadItemImage(blob);
          console.log("✅ Image uploaded to Supabase:", finalImageUrl);
        } catch(err) {
          console.warn("⚠️ Upload fallback, using base64:", err.message);
          // Se fallisce, mantieni il base64
        }
      }
      
      // Ora salva l'articolo con l'URL finale (Supabase o base64)
      const newItem = normalizeItemForLibrary({...found, imageUrl: finalImageUrl});
      itemLibrary.unshift(newItem);
      saveItemLibrary(itemLibrary);
      renderItemLibrary();
      ui.note.innerHTML = `<span class="ok">Articolo salvato nello storico.</span>`;
      
      // Auto-sync to Supabase if user is logged in
      if (currentUser) {
        supabaseUpsertItem(newItem).then(result => {
          if (!result.ok) {
            ui.note.innerHTML += ` <span class="warn">Errore cloud: ${result.error}</span>`;
          } else {
            ui.note.innerHTML += ` <span style="color: var(--success);">✓ Sincronizzato al cloud</span>`;
          }
        });
      }
    };
    
    processAndSave();
    return;
  }
  if(action === "pickItem"){
    openItemLibrary(id);
  }
  if(action === "pickGallery"){
    const fileInput = e.target.closest(".item")?.querySelector("input[data-k='imageFile']");
    if(fileInput) fileInput.click();
  }
  if(action === "capturePhoto"){
    const fileInput = e.target.closest(".item")?.querySelector("input[data-k='imageCamera']");
    if(fileInput) fileInput.click();
  }
});

// Listener per upload immagine nella commessa
ui.items.addEventListener("change", (e)=>{
  const input = e.target.closest("input[data-k='imageFile'], input[data-k='imageCamera']");
  if(!input) return;
  
  const file = input.files?.[0];
  if(!file) return;
  
  const wrap = e.target.closest(".item");
  const id = wrap?.getAttribute("data-id");
  if(!id) {
    console.log("❌ Could not find item ID");
    return;
  }
  
  console.log("✅ Item ID found:", id);
  ui.note.innerHTML = `<span class="mini">Compressione immagine...</span>`;
  
  // Comprimi l'immagine a base64 (NON upload a Supabase ancora)
  compressAndConvertImage(file).then((base64Url)=>{
    const idx = state.items.findIndex(x=>x.id===id);
    if(idx === -1) {
      console.log("❌ Item not found");
      return;
    }
    
    // Salva il base64 localmente (non uploadare a Supabase)
    state.items[idx].imageUrl = base64Url;
    console.log("✅ Image compressed and stored locally");
    
    saveState(state);
    renderItems();
    render();
    ui.note.innerHTML = `<span class="ok">✅ Immagine caricata. Clicca "Salva articolo" per salvare in permanenza.</span>`;
  }).catch((err)=>{
    console.error("❌ Compression error:", err);
    ui.note.innerHTML = `<span class="warn">Errore compressione immagine: ${escapeHtml(err.message || "")}</span>`;
  });
});

// Init
bindTop();
renderItems();
render();
initTheme();
renderLibrary();

/* ===========================
   AUTH EVENT LISTENERS
=========================== */
$("authLoginBtn").addEventListener("click", authLogin);
$("authRegisterBtn").addEventListener("click", authSignUp);
$("authGoogleBtn").addEventListener("click", authLoginGoogle);
$("authToggleRegister").addEventListener("click", toggleAuthForms);
$("authToggleLogin").addEventListener("click", toggleAuthForms);
$("logoutBtn").addEventListener("click", authLogout);
$("saveUserProfile").addEventListener("click", saveUserProfile);
$("deleteAccountBtn").addEventListener("click", deleteAccount);

// Load user profile when accordion opens
const accountDetails = $("accountDetails");
console.log("accountDetails element:", accountDetails);
if (accountDetails) {
  accountDetails.addEventListener("toggle", function() {
    console.log("Accordion toggle event fired! Open:", this.open);
    if (this.open) {
      console.log("Loading profile...");
      loadUserProfile();
    }
  });
}

/* ===========================
   INITIALIZE APP
=========================== */

// TEST IMMEDIATO - mostra stato su qualunque dispositivo
window.addEventListener('load', () => {
  setTimeout(() => {
    const debugEl = document.getElementById('uploadDebugLog');
    if(debugEl) {
      debugEl.innerHTML = '';
      debugEl.style.display = 'block';
      debugEl.textContent = '=== STATE CHECK ===\n';
      
      const msg1 = `Pagina caricata: ${new Date().toLocaleTimeString()}\n`;
      const msg2 = `Utente autenticato: ${currentUser ? 'SI - ' + currentUser.id.substring(0, 8) : 'NO'}\n`;
      const msg3 = `Supabase client: ${getAuthSupabaseClient() ? 'SI' : 'NO'}\n`;
      const msg4 = `localStorage: ${typeof localStorage !== 'undefined' ? 'SI' : 'NO'}\n`;
      const msg5 = `itemLibrary items: ${itemLibrary ? itemLibrary.length : 0}\n`;
      
      debugEl.textContent += msg1 + msg2 + msg3 + msg4 + msg5;
      debugEl.textContent += '\n--- PROVA A CLICCARE FOTO ---';
    }
  }, 500);
});

// Aspetta che il DOM sia pronto prima di inizializzare
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log("📄 DOM pronto, avvio inizializzazione...");
    initSupabase();
    renderItemLibrary();
  });
} else {
  // DOM già pronto
  console.log("📄 DOM già pronto, avvio inizializzazione...");
  initSupabase();
  renderItemLibrary();
}
