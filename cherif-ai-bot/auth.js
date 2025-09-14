// Firebase imports
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyALyzHcHMfYCCbF2eqinV7XlfOGJCDin4U",
 authDomain: "realestategpt-ai.firebaseapp.com",
  projectId: "realestategpt-ai",
  storageBucket: "realestategpt-ai.appspot.com",
  messagingSenderId: "822449246072",
  appId: "1:822449246072:web:82c572361d845f5d52c28d",
  measurementId: "G-W3BQEZKYZL"
};

// Init Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);


// Handle login modal toggle
const loginBtn = document.getElementById("login-btn");
const loginModal = document.getElementById("login-modal");
const closeModalBtn = document.getElementById("close-modal");

loginBtn.onclick = () => loginModal.style.display = "block";
closeModalBtn.onclick = () => loginModal.style.display = "none";

// Firebase Auth State
auth.onAuthStateChanged((user) => {
  if (user) {
    console.log("User signed in:", user.displayName || user.email);
    // Save name/email/etc
    // Optional: localStorage.setItem("user", JSON.stringify(user));
  } else {
    console.log("User signed out");
  }
});

// Sign in with Google
document.getElementById("google-signin").onclick = () => {
  const provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider).catch(console.error);
};

// Sign in with Apple
document.getElementById("apple-signin").onclick = () => {
  const provider = new firebase.auth.OAuthProvider('apple.com');
  auth.signInWithPopup(provider).catch(console.error);
};

// Sign in with Phone (you must set up reCAPTCHA container)
document.getElementById("phone-signin").onclick = () => {
  // Your phone auth logic with reCAPTCHA
  alert("Phone login setup coming soon.");
};

// Sign in with Email/Password
document.getElementById("email-signin").onclick = () => {
  const email = document.getElementById("email-input").value;
  const password = document.getElementById("password-input").value;
  auth.signInWithEmailAndPassword(email, password)
    .catch((error) => {
      console.error("Login failed:", error.message);
    });
};

// Sign up with Email/Password
document.getElementById("signup-btn").onclick = () => {
  const email = document.getElementById("email-input").value;
  const password = document.getElementById("password-input").value;
  auth.createUserWithEmailAndPassword(email, password)
    .catch((error) => {
      console.error("Signup failed:", error.message);
    });
};

// Logout
document.getElementById("logout-btn").onclick = () => {
  auth.signOut().then(() => {
    console.log("User signed out.");
  });
};
