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

function getAuthSupabaseClient() {
  return window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

async function initSupabase() {
  const sb = getAuthSupabaseClient();
  if (!sb) {
    console.error("Supabase non caricato");
    return;
  }
  
  // Check if user is already logged in
  const { data: { user } } = await sb.auth.getUser();
  if (user) {
    currentUser = user;
    await ensureUserProfile(sb, user);
    showMainApp();
  } else {
    showAuthScreen();
  }
  
  // Listen for auth changes
  sb.auth.onAuthStateChange(async (event, session) => {
    if (session?.user) {
      currentUser = session.user;
      await ensureUserProfile(sb, session.user);
      showMainApp();
    } else {
      currentUser = null;
      showAuthScreen();
    }
  });
}

async function ensureUserProfile(sb, user) {
  // Check if profile exists
  const { data, error } = await sb
    .from("user_profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  
  const now = new Date().toISOString();
  
  // If profile doesn't exist, create it
  if (!data) {
    console.log("Creating new user profile for:", user.id);
    const { error: insertError } = await sb.from("user_profiles").insert({
      id: user.id,
      email: user.email,
      company: user.user_metadata?.company || "N/A",
      created_at: now
    });
    
    if (insertError) {
      console.error("Error creating profile:", insertError);
    }
  } else {
    // Profile esiste già - aggiorna il created_at alla data odierna
    // (utile se l'utente ha eliminato e ricreato l'account)
    console.log("Profile exists - updating created_at");
    await sb
      .from("user_profiles")
      .update({ created_at: now })
      .eq("id", user.id);
  }
}

function showAuthScreen() {
  $("view-auth").style.display = "flex";
  $("view-main-app").style.display = "none";
}

function showMainApp() {
  $("view-auth").style.display = "none";
  $("view-main-app").style.display = "flex";
  $("view-main-app").style.flexDirection = "column";
  
  // Load user's quotes and items from Supabase
  if (currentUser) {
    supabaseLoadQuotes().then(quotes => {
      if (quotes.length > 0) {
        console.log("Loaded quotes from cloud, syncing to localStorage");
        quotes.forEach(q => {
          allQuotes[q.id] = q;
        });
        saveQuotesToLocalStorage();
        updateQuotesList();
      }
    });
    
    supabaseLoadItems().then(items => {
      if (items.length > 0) {
        console.log("Loaded items from cloud, syncing to localStorage");
        items.forEach(item => {
          itemLibrary[item.id] = item;
        });
        saveItemLibraryToLocalStorage();
        renderItemLibrary();
      }
    });
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
        company: company || "N/A",
        created_at: new Date().toISOString()
      });
      
      if (profileError) {
        console.error("Profile creation error:", profileError);
      }
      
      showAuthError("Account creato! Accedi con le tue credenziali.");
      toggleAuthForms();
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
    showMainApp();
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
        redirectTo: window.location.origin
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
  const sb = getAuthSupabaseClient();
  try {
    await sb.auth.signOut();
    currentUser = null;
    clearAuthError();
    clearAuthForms();
    showAuthScreen();
  } catch (err) {
    console.error("Logout error:", err);
  }
}

function showAuthError(message) {
  const errorEl = $("authError");
  errorEl.textContent = message;
  errorEl.style.display = "block";
}

function clearAuthError() {
  const errorEl = $("authError");
  errorEl.textContent = "";
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
    .select("*")
    .eq("id", currentUser.id)
    .single();
  
  console.log("User profile data:", data, "Error:", error);
  
  const userCompanyEl = $("userCompany");
  if (data && userCompanyEl) {
    userCompanyEl.value = data.company || "";
    console.log("Set userCompany to:", data.company);
  }
  
  console.log("=== loadUserProfile END ===");
}

async function supabaseUpsertQuote(quoteData) {
  if (!currentUser) {
    console.log("User not logged in, skipping cloud sync");
    return { ok: false, error: "User not logged in" };
  }
  
  const sb = getAuthSupabaseClient();
  const dataToSave = {
    user_id: currentUser.id,
    ...quoteData,
    updated_at: new Date().toISOString()
  };
  
  try {
    let result;
    if (quoteData.id) {
      // Update existing quote
      result = await sb
        .from("quotes")
        .update(dataToSave)
        .eq("id", quoteData.id)
        .eq("user_id", currentUser.id);
    } else {
      // Insert new quote
      result = await sb
        .from("quotes")
        .insert([{ ...dataToSave, created_at: new Date().toISOString() }]);
    }
    
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
      .select("*")
      .eq("user_id", currentUser.id)
      .order("created_at", { ascending: false });
    
    if (error) {
      console.error("Supabase load error:", error);
      return [];
    }
    
    console.log("Loaded quotes from Supabase:", data);
    return data || [];
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
  const dataToSave = {
    user_id: currentUser.id,
    ...itemData,
    updated_at: new Date().toISOString()
  };
  
  try {
    let result;
    if (itemData.id) {
      // Update existing item
      result = await sb
        .from("item_library")
        .update(dataToSave)
        .eq("id", itemData.id)
        .eq("user_id", currentUser.id);
    } else {
      // Insert new item
      result = await sb
        .from("item_library")
        .insert([{ ...dataToSave, created_at: new Date().toISOString() }]);
    }
    
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
      .select("*")
      .eq("user_id", currentUser.id)
      .order("created_at", { ascending: false });
    
    if (error) {
      console.error("Supabase load items error:", error);
      return [];
    }
    
    console.log("Loaded items from Supabase:", data);
    return data || [];
  } catch (err) {
    console.error("Exception in supabaseLoadItems:", err);
    return [];
  }
}

async function saveUserProfile() {
  if (!currentUser) return;
  
  const company = document.getElementById("userCompany").value;
  const sb = getAuthSupabaseClient();
  
  try {
    const { data, error } = await sb
      .from("user_profiles")
      .update({ company })
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
    
    // Cancella il profilo utente
    const profileResult = await sb
      .from("user_profiles")
      .delete()
      .eq("id", currentUser.id);
    console.log("Profile deletion result:", profileResult);
    
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



async function loadUserProfile() {
  if (!currentUser) return;
  
  const sb = getAuthSupabaseClient();
  
  // Set name
  const userName = currentUser.user_metadata?.full_name || 
                   currentUser.user_metadata?.name || 
                   currentUser.email?.split('@')[0] || 
                   "Utente";
  
  const userNameEl = $("userName");
  if (userNameEl) userNameEl.value = userName;
  
  // Set email
  const userEmailEl = $("userEmail");
  if (userEmailEl) userEmailEl.value = currentUser.email || "";
  
  // Set created date
  const userCreatedAtEl = $("userCreatedAt");
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
  }
  
  // Load company from database
  const { data } = await sb
    .from("user_profiles")
    .select("*")
    .eq("id", currentUser.id)
    .single();
  
  if (data) {
    const userCompanyEl = $("userCompany");
    if (userCompanyEl) userCompanyEl.value = data.company || "";
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

  const variableCosts = materialCost + printCost;

  // Series discount applies to variableCosts
  const isSeries = item.isSeries === true;
  const discountApplied = isSeries && qty >= seriesThresholdQty;
  const seriesDiscount = discountApplied ? variableCosts * seriesDiscountPct : 0;

  const itemBase = (variableCosts - seriesDiscount) + designCost;

  const marginPct = Math.max(0, num(group.marginPct, 0.25));
  const itemMargin = itemBase * marginPct;

  const itemTotal = itemBase + itemMargin;
  const unitPrice = itemTotal / qty;

  return {
    qty,
    grams,
    printHours,
    designHours,
    groupKey,
    materialCost,
    printCostBase,
    printCost,
    designCostBase,
    designCost,
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
    sums: { sumMat, sumPrint, sumDesign, sumDiscount, sumMargin, setupApplied, total }
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

const DEFAULTS = {
  order: { client: "", setupMode: "ORDER", quoteId: "", status: "DRAFT" },
  config: {
    materialEurPerGram: 0.15,
    machineEurPerHour: 2,
    designEurPerHour: 20,
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
  return `Q-${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
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
function saveState(s){ localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); }

function loadLibrary() {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function saveLibrary(list){ localStorage.setItem(LIBRARY_KEY, JSON.stringify(list)); }

function loadItemLibrary(){
  try{
    const raw = localStorage.getItem(ITEM_LIBRARY_KEY);
    if(!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  }catch{
    return [];
  }
}
function saveItemLibrary(list){ localStorage.setItem(ITEM_LIBRARY_KEY, JSON.stringify(list)); }

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
  sumDiscount: $("sumDiscount"),
  sumSetup: $("sumSetup"),
  sumMargin: $("sumMargin"),
  sumTotal: $("sumTotal"),
  note: $("note"),

  // print
  printHead: $("printHead"),
  printMeta: $("printMeta"),
  printItems: $("printItems"),
  p_sumMat: $("p_sumMat"),
  p_sumPrint: $("p_sumPrint"),
  p_sumDesign: $("p_sumDesign"),
  p_sumDiscount: $("p_sumDiscount"),
  p_sumSetup: $("p_sumSetup"),
  p_sumMargin: $("p_sumMargin"),
  p_total: $("p_total"),
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
        <label>Carica immagine (file)</label>
        <input data-k="imageFile" type="file" accept="image/*" />
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

function renderItems(){
  ui.items.innerHTML = state.items.map(itemTemplate).join("");
}

function readItemsFromDOM(){
  const wrappers = [...ui.items.querySelectorAll(".item")];
  state.items = wrappers.map(w=>{
    const id = w.getAttribute("data-id");
    const old = state.items.find(x=>x.id===id) || {};
    const get = (k)=> w.querySelector(`[data-k="${k}"]`);
    const hasDesign = get("hasDesign").checked;
    const materialOverrideOn = get("materialOverrideOn").checked;

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

  renderReportChart(byMonth);
  return { rows, total, count, paid, pending, draft, byMonth };
}

function renderReportChart(byMonth){
  if(!ui.reportChart) return;
  const ctx = ui.reportChart.getContext("2d");
  if(!ctx) return;
  const entries = Array.from(byMonth.entries()).sort((a,b)=> a[0].localeCompare(b[0]));

  // Clear
  ctx.clearRect(0,0,ui.reportChart.width, ui.reportChart.height);
  if(entries.length === 0){
    ctx.fillStyle = "#9ca3af";
    ctx.font = "12px system-ui";
    ctx.fillText("Nessun dato", 10, 20);
    return;
  }

  const w = ui.reportChart.width;
  const h = ui.reportChart.height;
  const padding = 30;
  const barW = Math.max(20, (w - padding*2) / entries.length - 8);
  const maxVal = Math.max(...entries.map(e=>e[1])) || 1;

  ctx.strokeStyle = "#e5e7eb";
  ctx.beginPath();
  ctx.moveTo(padding, h - padding);
  ctx.lineTo(w - padding, h - padding);
  ctx.stroke();

  entries.forEach((e, i)=>{
    const val = e[1];
    const x = padding + i * (barW + 8);
    const barH = (h - padding*2) * (val / maxVal);
    const y = h - padding - barH;
    ctx.fillStyle = "#111827";
    ctx.fillRect(x, y, barW, barH);
    ctx.fillStyle = "#6b7280";
    ctx.font = "10px system-ui";
    ctx.fillText(e[0].slice(5), x, h - 10);
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
function getSupabaseClient(){
  if(!cloud.enabled) return null;
  if(!cloud.url || !cloud.anonKey) return null;
  if(!window.supabase?.createClient) return null;
  return window.supabase.createClient(cloud.url, cloud.anonKey);
}

async function cloudUpsertQuote(snap){
  const client = getSupabaseClient();
  if(!client) return { ok:false, error:"Cloud non configurato" };
  const payload = {
    quote_id: snap.quoteId,
    client: snap.client,
    payload: snap.state,
    updated_at: new Date().toISOString()
  };
  const { error } = await client.from("quotes").upsert(payload, { onConflict: "quote_id" });
  return { ok: !error, error: error?.message };
}

async function cloudUpsertItem(item){
  const client = getSupabaseClient();
  if(!client) return { ok:false, error:"Cloud non configurato" };
  const payload = {
    item_id: item.id,
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
  const { data: quoteRows, error: qErr } = await client.from("quotes").select("quote_id, client, payload, updated_at");
  if(qErr) return { ok:false, error:qErr.message };

  const { data: itemRows, error: iErr } = await client.from("item_library").select("item_id, name, payload, updated_at");
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

  for(const snap of library){
    const payload = {
      quote_id: snap.quoteId || snap.id,
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
  const client = getSupabaseClient();
  if(!client){
    // fallback: local base64
    return new Promise((resolve, reject)=>{
      const reader = new FileReader();
      reader.onload = ()=> resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `items/${Date.now()}_${uid()}_${safeName}`;
  const { error } = await client.storage.from("item-images").upload(path, file, { upsert: true });
  if(error) throw new Error(error.message);
  const { data } = client.storage.from("item-images").getPublicUrl(path);
  return data?.publicUrl || "";
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
  ui.sumDiscount.textContent = "- " + eur(s.sumDiscount);
  ui.sumSetup.textContent = eur(s.setupApplied);
  ui.sumMargin.textContent = eur(s.sumMargin);
  ui.sumTotal.textContent = eur(s.total);

  const anyDiscount = s.sumDiscount > 0;
  
  // Validazioni globali
  const hasAnyZeroPrintHours = state.items.some(it => parseHoursSmart(it.printHoursPerPiece, 0) === 0);
  const hasAnyZeroDesignHours = state.items.some(it => it.hasDesign !== false && parseHoursSmart(it.designHours, 0) === 0);
  
  const warningsGlobal = [];
  if (hasAnyZeroPrintHours) warningsGlobal.push(`<span class="warn">⚠ Almeno un articolo ha ore stampa=0</span>`);
  if (hasAnyZeroDesignHours) warningsGlobal.push(`<span class="warn">⚠ Almeno un articolo ha design=SI ma ore=0</span>`);
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
      validations.push(`<span class="warn">⚠ Design=SI ma ore=0 → costo design 0€</span>`);
    }
    if (q.printHours === 0) {
      validations.push(`<span class="warn">⚠ Ore stampa=0 → controlla il valore</span>`);
    }
    if (q.qty === 0) {
      validations.push(`<span class="warn">⚠ Quantità=0</span>`);
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

  ui.p_sumMat.textContent = eur(s.sumMat);
  ui.p_sumPrint.textContent = eur(s.sumPrint);
  ui.p_sumDesign.textContent = eur(s.sumDesign);
  ui.p_sumDiscount.textContent = "- " + eur(s.sumDiscount);
  ui.p_sumSetup.textContent = eur(s.setupApplied);
  ui.p_sumMargin.textContent = eur(s.sumMargin);
  if(ui.p_rowDiscount) ui.p_rowDiscount.style.display = pdf.showDiscount ? "" : "none";
  if(ui.p_rowSetup) ui.p_rowSetup.style.display = pdf.showSetup ? "" : "none";
  if(ui.p_rowMargin) ui.p_rowMargin.style.display = pdf.showMargin ? "" : "none";
  ui.p_total.textContent = eur(s.total);

  if(pdf.showBaseCosts){
    ui.printFoot.textContent = `Costi base: materiale ${fmtComma(state.config.materialEurPerGram)} €/g — macchina ${fmtComma(state.config.machineEurPerHour)} €/h — design ${fmtComma(state.config.designEurPerHour)} €/h — setup ${fmtComma(state.config.machineSetupFee)} € — sconto serie ${Math.round(state.config.seriesDiscountPct*100)}% (soglia ${state.config.seriesThresholdQty}).`;
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
  lines.push(`Preventivo stampa 3D — Cliente: ${state.order.client || "-"}`);
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
    if (currentUser) {
      const result = await supabaseUpsertQuote(snap);
      if (!result.ok) {
        ui.note.innerHTML += ` <span class="warn">Errore cloud: ${result.error}</span>`;
      } else {
        ui.note.innerHTML += ` <span style="color: var(--success);">✓ Sincronizzato al cloud</span>`;
      }
    }
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
      return;
    }

    if(action === "edit"){
      loadItemEditForm(id);
      document.querySelector("details[open]")?.removeAttribute("open");
      document.querySelector("[class*='accordion']")?.setAttribute("open", "");
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

if(ui.itemEditSave){
  ui.itemEditSave.addEventListener("click", ()=>{
    const name = ui.itemEditName?.value?.trim();
    if(!name){
      ui.note.innerHTML = `<span class="warn">Inserisci un nome per l'articolo.</span>`;
      return;
    }

    const newItem = {
      id: currentEditItemId || uid(),
      name: name,
      imageUrl: "",
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
  if(e.target.matches("#client,#setupMode,#cfg_material,#cfg_machine,#cfg_design,#cfg_setup,#cfg_discount,#cfg_threshold,#gA_print,#gA_design,#gA_margin,#gB_print,#gB_design,#gB_margin,#gC_print,#gC_design,#gC_margin,#pdfShowGrams,#pdfShowHours,#pdfShowSetup,#pdfShowDiscount,#pdfShowMargin,#pdfShowBaseCosts")){
    recalcAndSave();
  }
});
document.addEventListener("change", (e)=>{
  if(e.target.matches("#client,#setupMode,#cfg_material,#cfg_machine,#cfg_design,#cfg_setup,#cfg_discount,#cfg_threshold,#gA_print,#gA_design,#gA_margin,#gB_print,#gB_design,#gB_margin,#gC_print,#gC_design,#gC_margin,#pdfShowGrams,#pdfShowHours,#pdfShowSetup,#pdfShowDiscount,#pdfShowMargin,#pdfShowBaseCosts")){
    recalcAndSave();
  }
});

// Delegate item inputs
ui.items.addEventListener("input", (e)=>{
  if(e.target.matches("input,select")) recalcAndSave();
});
ui.items.addEventListener("change", (e)=>{
  if(e.target.matches("input,select")) recalcAndSave();
  if(e.target.matches("input[data-k='imageFile']")){
    const input = e.target;
    const file = input.files?.[0];
    if(!file) return;
    const wrap = input.closest(".item");
    const id = wrap?.getAttribute("data-id");
    if(!id) return;
    ui.note.innerHTML = `<span class="mini">Caricamento immagine...</span>`;
    uploadItemImage(file).then((url)=>{
      readItemsFromDOM();
      const idx = state.items.findIndex(x=>x.id===id);
      if(idx === -1) return;
      state.items[idx].imageUrl = url;
      saveState(state);
      renderItems();
      render();
      ui.note.innerHTML = `<span class="ok">Immagine aggiornata.</span>`;
    }).catch((err)=>{
      ui.note.innerHTML = `<span class="warn">Errore upload immagine: ${escapeHtml(err.message || "")}</span>`;
    });
  }
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
  if(action === "saveItem"){
    readItemsFromDOM();
    const found = state.items.find(x=>x.id===id);
    if(!found) return;
    const newItem = normalizeItemForLibrary(found);
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
    } else if(cloud.enabled){
      cloudUpsertItem(newItem).then(res=>{
        if(!res.ok && ui.cloudStatus) ui.cloudStatus.textContent = `Cloud: ${res.error}`;
      });
    }
    return;
  }
  if(action === "pickItem"){
    openItemLibrary(id);
  }
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
initSupabase();
renderItemLibrary();
