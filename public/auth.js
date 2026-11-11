// Accounts for World Markets.
// Sign-in with Google or email and password (Firebase Authentication), plus one settings document
// per person in Firestore (users/{uid}) so the watchlist and colours follow them across devices.
// Exposes window.WMAuth for app.js. On localhost without a Firebase config it runs a demo stand-in
// so the site can be tried offline.
(() => {
  const SDK = "https://www.gstatic.com/firebasejs/13.2.0/";
  const cfg = window.FIREBASE_CONFIG;
  const listeners = new Set();
  let resolveReady;
  const A = (window.WMAuth = {
    user: null,
    known: false, // true once we know whether someone is signed in
    ready: new Promise((r) => (resolveReady = r)),
    onChange(fn) { listeners.add(fn); },
    token: async () => null,
    load: async () => null,
    save: async () => {},
    // access: "approved", "pending", "denied" or "none"; the owner approves everyone else
    access: async () => "none",
    onAccess() {},
    listAccess: async () => [],
    setAccess: async () => {},
  });
  const ADMIN = window.WM_ADMIN || "";
  const set = (u) => {
    A.user = u; A.known = true; resolveReady(u);
    listeners.forEach((fn) => { try { fn(u); } catch (e) { console.error(e); } });
  };
  const shape = (u) => u && {
    uid: u.uid,
    name: u.displayName || (u.email || "").split("@")[0] || "you",
    email: u.email || "",
    photo: u.photoURL || "",
    google: (u.providerData || []).some((p) => p.providerId === "google.com"),
    verified: !!u.emailVerified,
    admin: !!ADMIN && u.uid === ADMIN,
  };

  const local = ["localhost", "127.0.0.1"].includes(location.hostname);
  if (!cfg || !cfg.apiKey) {
    if (local) return demo();
    A.unavailable = "Sign-in isn't set up yet.";
    return set(null);
  }
  live().catch((e) => { console.error(e); A.unavailable = "The sign-in service didn't load. Check your connection and refresh."; set(null); });

  async function live() {
    const [appMod, au, fs] = await Promise.all([import(SDK + "firebase-app.js"), import(SDK + "firebase-auth.js"), import(SDK + "firebase-firestore.js")]);
    const app = appMod.initializeApp(cfg);
    const auth = au.getAuth(app), db = fs.getFirestore(app);
    const google = new au.GoogleAuthProvider();
    google.setCustomParameters({ prompt: "select_account" });
    const ref = () => fs.doc(db, "users", auth.currentUser.uid);
    Object.assign(A, {
      token: async () => (auth.currentUser ? auth.currentUser.getIdToken() : null),
      signInGoogle: async () => {
        try { await au.signInWithPopup(auth, google); }
        catch (e) {
          if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment") return au.signInWithRedirect(auth, google);
          throw e;
        }
      },
      signInEmail: (email, pw) => au.signInWithEmailAndPassword(auth, email, pw),
      signUpEmail: async (email, pw, name) => {
        const c = await au.createUserWithEmailAndPassword(auth, email, pw);
        if (name) { await au.updateProfile(c.user, { displayName: name }); set(shape(c.user)); }
        au.sendEmailVerification(c.user).catch(() => {});
      },
      resetPassword: (email) => au.sendPasswordResetEmail(auth, email),
      resendVerification: () => au.sendEmailVerification(auth.currentUser),
      // after the visitor clicks the link in the email: fetch the new state and a token that carries it
      refresh: async () => { const u = auth.currentUser; if (!u) return; await u.reload(); await u.getIdToken(true); set(shape(auth.currentUser)); },
      signOut: () => au.signOut(auth),
      deleteAccount: async () => {
        const u = auth.currentUser;
        if (!u) return;
        await fs.deleteDoc(ref()).catch(() => {});
        await u.delete();
      },
      // the visitor's own access entry, created as a request on first sign-in
      access: async () => {
        const u = auth.currentUser;
        if (!u) return "none";
        if (u.uid === ADMIN) return "approved";
        const r = fs.doc(db, "access", u.uid);
        const snap = await fs.getDoc(r);
        if (snap.exists()) return snap.data().status || "pending";
        await fs.setDoc(r, { status: "pending", email: u.email || "", name: u.displayName || "", requested: fs.serverTimestamp() });
        return "pending";
      },
      // tell the page as soon as the owner decides
      onAccess: (fn) => {
        const u = auth.currentUser;
        if (!u || u.uid === ADMIN) return () => {};
        return fs.onSnapshot(fs.doc(db, "access", u.uid), (snap) => fn(snap.exists() ? snap.data().status || "pending" : "none"), () => {});
      },
      listAccess: async () => {
        const snap = await fs.getDocs(fs.collection(db, "access"));
        return snap.docs.map((d) => ({ uid: d.id, ...d.data(), requested: d.data().requested && d.data().requested.toMillis ? d.data().requested.toMillis() : null }));
      },
      setAccess: async (uid, status) => (status ? fs.updateDoc(fs.doc(db, "access", uid), { status, decided: fs.serverTimestamp() }) : fs.deleteDoc(fs.doc(db, "access", uid))),
      load: async () => { if (!auth.currentUser) return null; const s = await fs.getDoc(ref()); return s.exists() ? s.data() : null; },
      save: async (data) => { if (auth.currentUser) await fs.setDoc(ref(), { ...data, updated: fs.serverTimestamp() }, { merge: true }); },
    });
    au.getRedirectResult(auth).catch(() => {});
    au.onAuthStateChanged(auth, (u) => set(shape(u)));
  }

  // offline stand-in: same interface, kept in this browser only
  function demo() {
    A.demo = true;
    const KEY = "wm-demo-user", DOC = "wm-demo-doc";
    const read = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
    const write = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
    const fail = (code) => { const e = new Error(code); e.code = code; throw e; };
    const signIn = (u) => { u.admin = u.uid === "demo"; write(KEY, u); set(u); };
    Object.assign(A, {
      token: async () => (A.user ? "mock-" + A.user.uid : null),
      signInGoogle: async () => signIn({ uid: "demo", name: "Demo User", email: "demo@example.com", photo: "", google: true, verified: true }),
      signInEmail: async (email, pw) => { if (!/@/.test(email)) fail("auth/invalid-email"); if (pw.length < 6) fail("auth/invalid-credential"); signIn({ uid: "demo", name: email.split("@")[0], email, photo: "", google: false, verified: true }); },
      signUpEmail: async (email, pw, name) => { if (!/@/.test(email)) fail("auth/invalid-email"); if (pw.length < 6) fail("auth/weak-password"); signIn({ uid: "demo", name: name || email.split("@")[0], email, photo: "", google: false, verified: false }); },
      resendVerification: async () => {},
      refresh: async () => { const u = read(KEY); if (u) { u.verified = true; signIn(u); } },
      resetPassword: async (email) => { if (!/@/.test(email)) fail("auth/invalid-email"); },
      signOut: async () => { write(KEY, null); set(null); },
      deleteAccount: async () => { write(DOC, null); write(KEY, null); set(null); },
      load: async () => read(DOC),
      save: async (data) => write(DOC, { ...(read(DOC) || {}), ...data }),
      // demo: uids starting "pending" wait for approval; "demo" is the owner
      access: async () => { const u = read(KEY); if (!u) return "none"; const a = read("wm-demo-access") || {}; return a[u.uid] || (u.uid.startsWith("pending") ? "pending" : "approved"); },
      onAccess: () => () => {},
      listAccess: async () => Object.entries(read("wm-demo-access") || { "pending-1": "pending" }).map(([uid, status]) => ({ uid, status, email: uid + "@example.com", name: uid, requested: Date.now() - 3600e3 })),
      setAccess: async (uid, status) => { const a = read("wm-demo-access") || { "pending-1": "pending" }; if (status) a[uid] = status; else delete a[uid]; write("wm-demo-access", a); },
    });
    setTimeout(() => { const u = read(KEY); if (u) u.admin = u.uid === "demo"; set(u); }, 150);
  }
})();
