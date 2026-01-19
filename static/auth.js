async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const msg = data?.error || `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

function setError(msg) {
  const el = document.querySelector("#error");
  if (!el) return;
  if (!msg) {
    el.classList.add("hidden");
    el.textContent = "";
  } else {
    el.classList.remove("hidden");
    el.textContent = msg;
  }
}

const toggle = document.querySelector("#togglePw");
const pw = document.querySelector("#pw");
if (toggle && pw) {
  toggle.addEventListener("click", () => {
    pw.type = pw.type === "password" ? "text" : "password";
  });
}

const loginForm = document.querySelector("#loginForm");
if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    setError("");

    const fd = new FormData(loginForm);
    const username = (fd.get("username") || "").toString().trim();
    const password = (fd.get("password") || "").toString();

    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      window.location.href = "/";
    } catch (err) {
      setError(err.message);
    }
  });
}

const registerForm = document.querySelector("#registerForm");
if (registerForm) {
  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    setError("");

    const fd = new FormData(registerForm);
    const username = (fd.get("username") || "").toString().trim();
    const password = (fd.get("password") || "").toString();

    try {
      await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      window.location.href = "/";
    } catch (err) {
      setError(err.message);
    }
  });
}
