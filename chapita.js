import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, getDoc, getDocFromServer, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendEmailVerification, sendPasswordResetEmail, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBfs9FUMFCMYGprhVSRj2vYx_kko0sbrHY",
  authDomain: "patitas-seguras-salta.firebaseapp.com",
  projectId: "patitas-seguras-salta",
  storageBucket: "patitas-seguras-salta.firebasestorage.app",
  messagingSenderId: "311814224464",
  appId: "1:311814224464:web:6cd643e607fbb90c3b6f55"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Huellita SVG integrada (nunca falla ni depende de links externos)
const DEFAULT_PAW_SVG = "data:image/svg+xml;utf8," + encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
    <g fill="#315878">
      <ellipse cx="100" cy="122" rx="34" ry="28"/>
      <circle cx="62" cy="84" r="14"/>
      <circle cx="88" cy="66" r="14"/>
      <circle cx="116" cy="66" r="14"/>
      <circle cx="140" cy="86" r="14"/>
    </g>
  </svg>
`);

const tagId = document.documentElement.dataset.tagId;

const byId = (id) => document.getElementById(id);
const viewForm = byId("view-form");
const viewAccount = byId("view-account");
const loginForm = byId("login-form");
const emailInput = byId("account-email");
const passwordInput = byId("account-password");
const accountStatus = byId("account-status");
const formStatus = byId("form-status");
const saveButton = byId("btn-save");
const cancelButton = byId("btn-cancel-edit");
const photoInput = byId("inp-photo");
const preview = byId("preview-photo");
const gpsLabel = byId("gps-label");
const defaultGpsLabel = gpsLabel.textContent;
const screens = ["loader", "view-error", "view-public", "view-inactive", "view-account", "view-form"];

let currentPetData = null;
let compressedBase64 = "";
let photoSelection = 0;
let checkingAccount = false;

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const maxSize = 500;
        let width = img.width;
        let height = img.height;
        if (width > height && width > maxSize) {
          height *= maxSize / width;
          width = maxSize;
        } else if (height > maxSize) {
          width *= maxSize / height;
          height = maxSize;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

photoInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const selection = ++photoSelection;
  saveButton.disabled = true;
  formStatus.textContent = "";
  try {
    const photo = await compressImage(file);
    if (selection !== photoSelection) return;
    if (!photo.startsWith("data:image/jpeg;base64,") || photo.length > 650000) {
      throw new Error("Foto inválida");
    }
    compressedBase64 = photo;
    preview.src = photo;
    preview.classList.remove("hidden");
  } catch {
    if (selection !== photoSelection) return;
    photoInput.value = "";
    formStatus.textContent = "No se pudo usar esa foto. Elegí otra imagen.";
  } finally {
    if (selection === photoSelection) saveButton.disabled = false;
  }
});

// Limpia 0 inicial y 15 después del código de área (ej: 0387 154123456 -> 5493874123456)
function formatArgentinaPhone(raw) {
  let clean = raw.replace(/\D/g, "");
  if (clean.startsWith("549")) clean = clean.substring(3);
  else if (clean.startsWith("54")) clean = clean.substring(2);
  if (clean.startsWith("0")) clean = clean.substring(1);

  // Si tiene 12 dígitos y un "15" después del código de área de 3 dígitos (ej: 387 + 15 + 7 dígitos)
  if (clean.length === 12 && clean.substring(3, 5) === "15") {
    clean = clean.substring(0, 3) + clean.substring(5);
  }
  // Si tiene 12 dígitos y un "15" después de código de 2 o 4 dígitos
  else if (clean.length === 12 && clean.substring(2, 4) === "15") {
    clean = clean.substring(0, 2) + clean.substring(4);
  }
  else if (clean.length === 12 && clean.substring(4, 6) === "15") {
    clean = clean.substring(0, 4) + clean.substring(6);
  }

  return "549" + clean;
}

function showScreen(id) {
  for (const screen of screens) {
    byId(screen).classList.toggle("hidden", screen !== id);
  }
}

function showPublicView(data) {
  showScreen("view-public");
  document.getElementById("pub-id").textContent = tagId;
  document.getElementById("pub-name").textContent = data.name;
  const photo = byId("pub-photo");
  photo.src = data.photo || DEFAULT_PAW_SVG;
  photo.alt = data.photo ? `Foto de ${data.name}` : "";

  const notesContainer = document.getElementById("pub-notes-container");
  if (data.notes && data.notes.trim() !== "") {
    document.getElementById("pub-notes").textContent = data.notes;
    notesContainer.classList.remove("hidden");
  } else {
    notesContainer.classList.add("hidden");
  }

  const fullPhone = formatArgentinaPhone(data.phone);
  const baseMsg = encodeURIComponent(`¡Hola! Encontré a ${data.name}. Me comunico desde su chapita inteligente.`);

  document.getElementById("btn-wpp").href = `https://wa.me/${fullPhone}?text=${baseMsg}`;
  document.getElementById("btn-call").href = `tel:+${fullPhone}`;

  document.getElementById("btn-send-gps").onclick = () => {
    gpsLabel.textContent = "Obteniendo tu ubicación...";
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const mapsUrl = `https://maps.google.com/?q=${lat},${lng}`;
          const gpsMsg = encodeURIComponent(`¡Hola! Encontré a ${data.name}. Estoy en esta ubicación ahora: ${mapsUrl}`);
          gpsLabel.textContent = defaultGpsLabel;
          window.location.href = `https://wa.me/${fullPhone}?text=${gpsMsg}`;
        },
        () => {
          gpsLabel.textContent = defaultGpsLabel;
          alert("No se pudo obtener el GPS automático. Te abrimos WhatsApp para que envíes tu ubicación desde el clip.");
          window.location.href = `https://wa.me/${fullPhone}?text=${baseMsg}`;
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    } else {
      gpsLabel.textContent = defaultGpsLabel;
      window.location.href = `https://wa.me/${fullPhone}?text=${baseMsg}`;
    }
  };
}

function showTag() {
  photoSelection++;
  if (currentPetData) showPublicView(currentPetData);
  else showScreen("view-inactive");
}

function showForm() {
  const data = currentPetData;
  byId("form-badge").textContent = data ? "Editar chapita" : "Activar chapita";
  byId("form-title").textContent = data ? "Editar ficha de " + data.name : "Configurá tu mascota";
  byId("form-subtitle").textContent = "Los datos de la ficha se muestran al escanear la chapita #" + tagId + ".";
  byId("inp-name").value = data?.name ?? "";
  byId("inp-phone").value = data?.phone ?? "";
  byId("inp-notes").value = data?.notes ?? "";
  photoInput.value = "";
  compressedBase64 = data?.photo ?? "";
  preview.src = compressedBase64 || DEFAULT_PAW_SVG;
  preview.classList.toggle("hidden", !compressedBase64);
  formStatus.textContent = "";
  saveButton.disabled = false;
  showScreen("view-form");
  byId("inp-name").focus();
}

function renderAccount(user) {
  loginForm.classList.toggle("hidden", !!user);
  byId("session-actions").classList.toggle("hidden", !user);
  byId("btn-resend-verification").classList.toggle("hidden", !user || user.emailVerified);
  byId("account-title").textContent = user ? "Acceso a la chapita" : "Ingresá a tu cuenta";
}

async function accountAction(action, errorMessage) {
  if (checkingAccount) return;
  checkingAccount = true;
  accountStatus.textContent = "Un momento…";
  const buttons = viewAccount.querySelectorAll("button");
  for (const button of buttons) button.disabled = true;
  try {
    await action();
  } catch (err) {
    accountStatus.textContent = err.code === "permission-denied"
      ? "Esta cuenta todavía no tiene asignada la chapita."
      : errorMessage;
  } finally {
    passwordInput.value = "";
    renderAccount(auth.currentUser);
    checkingAccount = false;
    for (const button of buttons) button.disabled = false;
  }
}

async function checkAssignment(user) {
  await user.reload();
  if (!user.emailVerified) {
    accountStatus.textContent = "Verificá tu correo y después tocá «Comprobar acceso».";
    return;
  }
  await user.getIdToken(true);
  const assignment = await getDocFromServer(doc(db, "chapitasPermisos", tagId));
  if (auth.currentUser?.uid === user.uid && assignment.data()?.ownerUid === user.uid) {
    showForm();
  }
}

function openAccount() {
  accountStatus.textContent = "";
  renderAccount(auth.currentUser);
  showScreen("view-account");
  if (auth.currentUser) {
    accountAction(() => checkAssignment(auth.currentUser), "No se pudo comprobar el acceso. Volvé a intentar.");
  } else emailInput.focus();
}

onAuthStateChanged(auth, (user) => {
  if (!user && !viewForm.classList.contains("hidden")) showTag();
  renderAccount(user);
});

byId("btn-open-edit").addEventListener("click", openAccount);
byId("btn-open-activation").addEventListener("click", openAccount);
byId("btn-back-to-nfc").addEventListener("click", showTag);
cancelButton.addEventListener("click", showTag);

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  accountAction(async () => {
    const { user } = await signInWithEmailAndPassword(auth, emailInput.value.trim(), passwordInput.value);
    await checkAssignment(user);
  }, "No se pudo ingresar o comprobar el acceso. Revisá tus datos y volvé a intentar.");
});

byId("btn-create-account").addEventListener("click", () => {
  if (!loginForm.reportValidity()) return;
  accountAction(async () => {
    const { user } = await createUserWithEmailAndPassword(auth, emailInput.value.trim(), passwordInput.value);
    await sendEmailVerification(user);
    accountStatus.textContent = "Te enviamos un correo para verificar tu cuenta.";
  }, "No se pudo completar el registro. Si ya tenés cuenta, ingresá o restablecé la contraseña.");
});

byId("btn-reset-password").addEventListener("click", () => {
  if (!emailInput.reportValidity()) return;
  accountAction(async () => {
    await sendPasswordResetEmail(auth, emailInput.value.trim());
    accountStatus.textContent = "Si existe una cuenta con ese correo, vas a recibir un enlace para restablecer la contraseña.";
  }, "No se pudo solicitar el correo. Volvé a intentar.");
});

byId("btn-check-account").addEventListener("click", () => {
  if (auth.currentUser) {
    accountAction(() => checkAssignment(auth.currentUser), "No se pudo comprobar el acceso. Volvé a intentar.");
  }
});

byId("btn-resend-verification").addEventListener("click", () => {
  if (!auth.currentUser) return;
  accountAction(async () => {
    await sendEmailVerification(auth.currentUser);
    accountStatus.textContent = "Te enviamos otro correo de verificación.";
  }, "No se pudo reenviar el correo. Volvé a intentar más tarde.");
});

byId("btn-sign-out").addEventListener("click", () => {
  accountAction(async () => {
    await signOut(auth);
    accountStatus.textContent = "";
  }, "No se pudo cerrar la sesión. Volvé a intentar.");
});

viewForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (saveButton.disabled) return;
  const name = byId("inp-name").value.trim();
  const phone = byId("inp-phone").value.trim();
  const notes = byId("inp-notes").value.trim();
  if (!name || !phone) {
    formStatus.textContent = "Completá el nombre y el teléfono de contacto.";
    return;
  }

  const wasActive = !!currentPetData;
  const ref = doc(db, "chapitas", tagId);
  const payload = { name, phone, notes, photo: compressedBase64, updatedAt: new Date().toISOString() };
  saveButton.disabled = true;
  cancelButton.disabled = true;
  photoInput.disabled = true;
  formStatus.textContent = "Guardando…";
  try {
    await runTransaction(db, async (transaction) => {
      const existing = await transaction.get(ref);
      if (existing.exists() !== wasActive) throw new Error("ficha-cambió");
      transaction.set(ref, payload);
    });
    currentPetData = payload;
    showTag();
  } catch (err) {
    formStatus.textContent = err.code === "permission-denied"
      ? "Tu cuenta no tiene permiso para guardar esta ficha."
      : err.message === "ficha-cambió"
        ? "La ficha cambió. Volvé a abrir el enlace antes de guardar."
        : "No se pudo guardar. Revisá tu conexión y volvé a intentar.";
  } finally {
    saveButton.disabled = false;
    cancelButton.disabled = false;
    photoInput.disabled = false;
  }
});

async function init() {
  try {
    const snapshot = await getDoc(doc(db, "chapitas", tagId));
    currentPetData = snapshot.exists() ? snapshot.data() : null;
    showTag();
  } catch (err) {
    if (err.code === "permission-denied") {
      byId("view-error").querySelector(".badge").textContent = "Ficha no disponible";
      byId("view-error").querySelector(".subtitle").textContent = "Volvé a intentar más tarde.";
    }
    showScreen("view-error");
  }
}

init();
