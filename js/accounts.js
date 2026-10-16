/* Member accounts for this static site.
   Records live in this file's seed list and in localStorage under ww_accounts_v1.
   Passwords are stored only as a SHA-256 hash. Nothing is sent to a server. */
(function () {
  const ACCOUNTS_KEY = "ww_accounts_v1";
  const SESSION_KEY = "ww_session_v1";
  const TRIPS_KEY = "ww_member_itineraries_v1";

  // Add a record here to ship an account with the site:
  // { name, email, passwordHash, createdAt }
  const fileAccounts = [];
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  function authFile(url) {
    try {
      const name = new URL(url, window.location.href).pathname.split("/").pop() || "index.html";
      return name.toLowerCase();
    } catch (_) {
      return "";
    }
  }

  function authSlideType(fromUrl, toUrl) {
    const from = authFile(fromUrl);
    const to = authFile(toUrl);
    if (from === "sign-in.html" && to === "sign-up.html") return "auth-forward";
    if (from === "sign-up.html" && to === "sign-in.html") return "auth-back";
    return "";
  }

  function tagAuthTransition(transition, fromUrl, toUrl) {
    if (!transition) return;
    if (reducedMotion.matches) {
      transition.skipTransition();
      return;
    }
    const type = authSlideType(fromUrl, toUrl);
    if (!type) {
      transition.skipTransition();
      return;
    }
    transition.types.add(type);
  }

  window.addEventListener("pageswap", function (event) {
    const destination =
      event.activation && event.activation.entry ? event.activation.entry.url : "";
    tagAuthTransition(event.viewTransition, window.location.href, destination);
  });
  window.addEventListener("pagereveal", function (event) {
    const origin =
      window.navigation &&
      window.navigation.activation &&
      window.navigation.activation.from
        ? window.navigation.activation.from.url
        : "";
    tagAuthTransition(event.viewTransition, origin, window.location.href);
  });

  function initAuthSlideFallback() {
    if ("onpagereveal" in window) return;
    document.querySelectorAll(".account-switch a").forEach(function (link) {
      link.addEventListener("click", function (event) {
        if (
          reducedMotion.matches ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          event.button !== 0
        )
          return;
        const type = authSlideType(window.location.href, link.href);
        if (!type) return;
        event.preventDefault();
        try {
          sessionStorage.setItem("ww_auth_enter", type);
        } catch (_) {}
        document.documentElement.classList.add(
          type === "auth-forward" ? "auth-leave-forward" : "auth-leave-back",
        );
        window.setTimeout(function () {
          window.location.href = link.href;
        }, 360);
      });
    });
  }

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null || raw === "") return fallback;
      return JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function accounts() {
    const merged = new Map();
    fileAccounts.forEach(function (account) {
      if (account && account.email) merged.set(String(account.email).toLowerCase(), account);
    });
    const stored = readJson(ACCOUNTS_KEY, []);
    if (Array.isArray(stored)) {
      stored.forEach(function (account) {
        if (account && account.email) merged.set(String(account.email).toLowerCase(), account);
      });
    }
    return Array.from(merged.values());
  }

  function persist(list) {
    writeJson(ACCOUNTS_KEY, list);
  }

  function publicUser(account) {
    return {
      name: account.name,
      email: account.email,
      createdAt: account.createdAt,
    };
  }

  async function digest(password) {
    if (!window.crypto || !window.crypto.subtle) {
      const error = new Error("crypto");
      error.code = "crypto";
      throw error;
    }
    const bytes = new TextEncoder().encode("wanderlust-world:" + password);
    const buffer = await window.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(buffer))
      .map(function (value) {
        return value.toString(16).padStart(2, "0");
      })
      .join("");
  }

  function notify() {
    document.dispatchEvent(new CustomEvent("ww:session"));
  }

  window.WWAccounts = {
    current: function () {
      const email = readJson(SESSION_KEY, "");
      if (typeof email !== "string" || !email) return null;
      const account = accounts().find(function (item) {
        return item.email === email;
      });
      return account ? publicUser(account) : null;
    },
    signUp: async function (input) {
      const name = String(input.name || "")
        .trim()
        .replace(/\s+/g, " ");
      const email = String(input.email || "")
        .trim()
        .toLowerCase();
      const password = String(input.password || "");
      if (name.length < 2) return { ok: false, code: "name" };
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120)
        return { ok: false, code: "email" };
      if (password.length < 8) return { ok: false, code: "password" };
      const list = accounts();
      if (
        list.some(function (item) {
          return item.email === email;
        })
      )
        return { ok: false, code: "taken" };
      let passwordHash;
      try {
        passwordHash = await digest(password);
      } catch (error) {
        return { ok: false, code: error.code === "crypto" ? "crypto" : "storage" };
      }
      const account = {
        name: name,
        email: email,
        passwordHash: passwordHash,
        createdAt: new Date().toISOString(),
      };
      list.push(account);
      try {
        persist(list);
        writeJson(SESSION_KEY, email);
      } catch (_) {
        return { ok: false, code: "storage" };
      }
      notify();
      return { ok: true, user: publicUser(account) };
    },
    signIn: async function (input) {
      const email = String(input.email || "")
        .trim()
        .toLowerCase();
      const password = String(input.password || "");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        return { ok: false, code: "email" };
      if (password.length < 8) return { ok: false, code: "password" };
      let passwordHash;
      try {
        passwordHash = await digest(password);
      } catch (error) {
        return { ok: false, code: error.code === "crypto" ? "crypto" : "storage" };
      }
      const account = accounts().find(function (item) {
        return item.email === email && item.passwordHash === passwordHash;
      });
      if (!account) return { ok: false, code: "credentials" };
      try {
        writeJson(SESSION_KEY, email);
      } catch (_) {
        return { ok: false, code: "storage" };
      }
      notify();
      return { ok: true, user: publicUser(account) };
    },
    signOut: function () {
      try {
        localStorage.removeItem(SESSION_KEY);
      } catch (_) {}
      notify();
    },
    saveItinerary: function (record) {
      const user = this.current();
      if (!user) return false;
      const all = readJson(TRIPS_KEY, {});
      const list = all && Array.isArray(all[user.email]) ? all[user.email] : [];
      list.push(record);
      const next = all && typeof all === "object" ? all : {};
      next[user.email] = list;
      try {
        writeJson(TRIPS_KEY, next);
      } catch (_) {
        return false;
      }
      return true;
    },
    itineraries: function () {
      const user = this.current();
      if (!user) return [];
      const all = readJson(TRIPS_KEY, {});
      const list = all && Array.isArray(all[user.email]) ? all[user.email] : [];
      return list.slice().sort(function (a, b) {
        return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
      });
    },
    removeItinerary: function (ref) {
      const user = this.current();
      if (!user) return false;
      const all = readJson(TRIPS_KEY, {});
      const list = all && Array.isArray(all[user.email]) ? all[user.email] : [];
      const next = all && typeof all === "object" ? all : {};
      next[user.email] = list.filter(function (item) {
        return item.ref !== ref;
      });
      try {
        writeJson(TRIPS_KEY, next);
        const bookings = JSON.parse(localStorage.getItem("ww_bookings") || "[]");
        if (Array.isArray(bookings)) {
          localStorage.setItem(
            "ww_bookings",
            JSON.stringify(
              bookings.filter(function (item) {
                return item.ref !== ref;
              }),
            ),
          );
        }
      } catch (_) {
        return false;
      }
      return true;
    },
  };

  function t(key, vars) {
    return window.wwT ? window.wwT(key, vars) : key;
  }

  function safeNext(value) {
    if (!value) return "";
    let decoded = value;
    try {
      decoded = decodeURIComponent(value);
    } catch (_) {}
    if (!/^[a-z0-9-]+\.html(\?resume=1)?$/.test(decoded)) return "";
    return decoded;
  }

  function nextTarget() {
    return safeNext(new URLSearchParams(window.location.search).get("next"));
  }

  function goNext() {
    window.location.href = nextTarget() || "./itinerary.html";
  }

  function wireNextLinks() {
    const next = nextTarget();
    if (!next) return;
    document.querySelectorAll("[data-auth-next]").forEach(function (link) {
      const base = (link.getAttribute("href") || "").split("?")[0];
      link.setAttribute("href", base + "?next=" + encodeURIComponent(next));
    });
  }

  function fieldError(input) {
    return document.getElementById(input.id + "-error");
  }

  function describedBy(input, error) {
    const help = document.getElementById(input.id + "-help");
    const ids = [];
    if (help) ids.push(help.id);
    if (error && !error.hidden) ids.push(error.id);
    if (ids.length) input.setAttribute("aria-describedby", ids.join(" "));
    else input.removeAttribute("aria-describedby");
  }

  function clearField(input) {
    const error = fieldError(input);
    input.removeAttribute("aria-invalid");
    if (error) {
      error.hidden = true;
      error.textContent = "";
      delete error.dataset.errorKey;
    }
    describedBy(input, error);
  }

  function setFieldError(input, key) {
    const error = fieldError(input);
    input.setAttribute("aria-invalid", "true");
    if (!error) return;
    error.hidden = false;
    error.dataset.errorKey = key;
    error.textContent = t(key);
    describedBy(input, error);
  }

  function setFormError(form, key) {
    const error = form.querySelector(".form-error");
    if (!error) return;
    if (!key) {
      error.hidden = true;
      error.textContent = "";
      delete error.dataset.errorKey;
      return;
    }
    error.hidden = false;
    error.dataset.errorKey = key;
    error.textContent = t(key);
  }

  function refreshErrors(form) {
    form.querySelectorAll(".field-error, .form-error").forEach(function (error) {
      if (!error.dataset.errorKey || error.hidden) return;
      error.textContent = t(error.dataset.errorKey);
    });
  }

  const errorText = {
    name: "account.errName",
    email: "account.errEmail",
    password: "account.errPassword",
    taken: "account.errTaken",
    credentials: "account.errCredentials",
    storage: "account.errStorage",
    crypto: "account.errCrypto",
  };

  function bindAuthForm(form, mode) {
    const submit = form.querySelector('button[type="submit"]');
    form.querySelectorAll("input").forEach(function (input) {
      input.addEventListener("input", function () {
        clearField(input);
        setFormError(form, "");
      });
    });
    document.addEventListener("ww:lang", function () {
      refreshErrors(form);
      if (submit && !submit.disabled) {
        const key = submit.getAttribute("data-i18n");
        if (key) submit.textContent = t(key);
      }
    });
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      const nameInput = form.querySelector("#account-name");
      const emailInput = form.querySelector("#account-email");
      const passwordInput = form.querySelector("#account-password");
      const confirmInput = form.querySelector("#account-confirm");
      const termsInput = form.querySelector("#accept-terms");
      [nameInput, emailInput, passwordInput, confirmInput, termsInput]
        .filter(Boolean)
        .forEach(clearField);
      setFormError(form, "");

      let invalid = false;
      const focus = [];
      if (nameInput && nameInput.value.trim().replace(/\s+/g, " ").length < 2) {
        setFieldError(nameInput, "account.errName");
        focus.push(nameInput);
        invalid = true;
      }
      if (
        !emailInput ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput.value.trim())
      ) {
        setFieldError(emailInput, "account.errEmail");
        focus.push(emailInput);
        invalid = true;
      }
      if (!passwordInput || passwordInput.value.length < 8) {
        setFieldError(passwordInput, "account.errPassword");
        focus.push(passwordInput);
        invalid = true;
      }
      if (confirmInput && confirmInput.value !== passwordInput.value) {
        setFieldError(confirmInput, "account.errMatch");
        focus.push(confirmInput);
        invalid = true;
      }
      if (termsInput && !termsInput.checked) {
        setFieldError(termsInput, "account.errTerms");
        focus.push(termsInput);
        invalid = true;
      }
      if (invalid) {
        focus[0].focus();
        return;
      }

      const labelKey = submit.getAttribute("data-i18n");
      submit.disabled = true;
      submit.textContent = t("account.working");
      const result =
        mode === "sign-up"
          ? await window.WWAccounts.signUp({
              name: nameInput.value,
              email: emailInput.value,
              password: passwordInput.value,
            })
          : await window.WWAccounts.signIn({
              email: emailInput.value,
              password: passwordInput.value,
            });
      if (!result.ok) {
        submit.disabled = false;
        submit.textContent = t(labelKey);
        const code = result.code;
        if (code === "email" && emailInput) setFieldError(emailInput, errorText.email);
        else if (code === "password" && passwordInput)
          setFieldError(passwordInput, errorText.password);
        else if (code === "name" && nameInput) setFieldError(nameInput, errorText.name);
        else if (code === "taken" && emailInput) setFieldError(emailInput, errorText.taken);
        else setFormError(form, errorText[code] || "account.errStorage");
        return;
      }
      goNext();
    });
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (character) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[character];
    });
  }

  function label(group, value) {
    const key = group + "." + value;
    const translated = t(key);
    return translated === key ? value : translated;
  }

  function formatPrice(amount) {
    return "HK$" + Number(amount).toLocaleString("en-HK");
  }

  function formatDate(dateStr) {
    const date = new Date(dateStr + "T00:00:00");
    if (Number.isNaN(date.getTime())) return dateStr;
    const locale = document.documentElement.lang === "zh-HK" ? "zh-HK" : "en-HK";
    return date.toLocaleDateString(locale, {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  function formatSaved(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    const locale = document.documentElement.lang === "zh-HK" ? "zh-HK" : "en-HK";
    return date.toLocaleDateString(locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  function routeMarkup(flight) {
    return (
      '<div class="itinerary-route">' +
      "<div><strong>" +
      escapeHtml(flight.from) +
      "</strong><span>" +
      escapeHtml(label("city", flight.fromCity)) +
      "</span></div>" +
      '<span class="itinerary-path" aria-hidden="true"><i></i></span>' +
      "<div><strong>" +
      escapeHtml(flight.to) +
      "</strong><span>" +
      escapeHtml(label("city", flight.toCity)) +
      "</span></div></div>"
    );
  }

  function renderItinerary() {
    const root = document.getElementById("itinerary-list");
    if (!root || !window.WWAccounts) return;
    const user = window.WWAccounts.current();
    const gate = document.getElementById("itinerary-gate");
    const empty = document.getElementById("itinerary-empty");
    const count = document.getElementById("itinerary-count");
    const book = document.getElementById("itinerary-book");
    const signOut = document.getElementById("itinerary-signout");
    const trips = user ? window.WWAccounts.itineraries() : [];

    if (gate) gate.hidden = Boolean(user);
    if (signOut) signOut.hidden = !user;
    if (empty) empty.hidden = !user || trips.length > 0;
    if (book) book.hidden = !user || trips.length === 0;
    if (count) {
      count.hidden = !user || trips.length === 0;
      count.textContent = t(trips.length === 1 ? "itinerary.countOne" : "itinerary.countMany", {
        n: trips.length,
      });
    }
    if (!user) {
      root.innerHTML = "";
      return;
    }

    root.innerHTML = trips
      .map(function (record) {
        const flight = record.flight || {};
        const fare = record.fare || {};
        const who = t(
          Number(record.passengers) === 1 ? "booking.traveler" : "booking.travelers",
        );
        const airline = label("airline", flight.airline);
        return (
          '<article class="trip-card" data-ref="' +
          escapeHtml(record.ref) +
          '">' +
          routeMarkup(flight) +
          '<p class="itinerary-meta">' +
          escapeHtml(airline) +
          " · " +
          escapeHtml(flight.id || "") +
          "<br>" +
          escapeHtml(formatDate(flight.departDate || "")) +
          " · " +
          escapeHtml(flight.departTime || "") +
          " - " +
          escapeHtml(flight.arriveTime || "") +
          "</p>" +
          '<dl class="confirmation-details">' +
          "<div><dt>" +
          escapeHtml(t("booking.passenger")) +
          "</dt><dd>" +
          escapeHtml(record.name || "") +
          "</dd></div>" +
          "<div><dt>" +
          escapeHtml(t("booking.passengers")) +
          "</dt><dd>" +
          escapeHtml(record.passengers) +
          "</dd></div>" +
          "<div><dt>" +
          escapeHtml(t("booking.cabin")) +
          "</dt><dd>" +
          escapeHtml(label("cabin", fare.cabin || "")) +
          " · " +
          escapeHtml(fare.brand || "") +
          "</dd></div>" +
          "<div><dt>" +
          escapeHtml(t("booking.reference")) +
          "</dt><dd>" +
          escapeHtml(record.ref || "") +
          "</dd></div></dl>" +
          '<div class="confirmation-total"><span>' +
          escapeHtml(t("booking.total", { n: record.passengers, who: who })) +
          "</span><strong>" +
          escapeHtml(formatPrice(record.total)) +
          "</strong></div>" +
          '<p class="trip-saved">' +
          escapeHtml(t("itinerary.saved", { date: formatSaved(record.createdAt) })) +
          "</p>" +
          '<div class="trip-actions">' +
          '<button type="button" class="btn btn-quiet" data-remove-trip="' +
          escapeHtml(record.ref) +
          '">' +
          escapeHtml(t("itinerary.remove")) +
          "</button></div>" +
          '<div class="trip-confirm" hidden>' +
          "<p>" +
          escapeHtml(t("itinerary.removeAsk")) +
          "</p>" +
          '<div class="itinerary-actions">' +
          '<button type="button" class="btn" data-remove-confirm="' +
          escapeHtml(record.ref) +
          '">' +
          escapeHtml(t("itinerary.removeYes")) +
          "</button>" +
          '<button type="button" class="btn btn-quiet" data-remove-cancel>' +
          escapeHtml(t("itinerary.keep")) +
          "</button></div></div></article>"
        );
      })
      .join("");
  }

  function initItinerary() {
    const root = document.getElementById("itinerary-list");
    if (!root) return;
    renderItinerary();
    document.addEventListener("ww:lang", renderItinerary);
    document.addEventListener("ww:session", renderItinerary);
    root.addEventListener("click", function (event) {
      const remove = event.target.closest("[data-remove-trip]");
      if (remove) {
        const card = remove.closest(".trip-card");
        root.querySelectorAll(".trip-confirm").forEach(function (panel) {
          panel.hidden = true;
        });
        root.querySelectorAll(".trip-actions").forEach(function (panel) {
          panel.hidden = false;
        });
        const ask = card.querySelector(".trip-confirm");
        const actions = card.querySelector(".trip-actions");
        if (ask && actions) {
          actions.hidden = true;
          ask.hidden = false;
          ask.querySelector("button").focus();
        }
        return;
      }
      if (event.target.closest("[data-remove-cancel]")) {
        const card = event.target.closest(".trip-card");
        card.querySelector(".trip-confirm").hidden = true;
        card.querySelector(".trip-actions").hidden = false;
        card.querySelector("[data-remove-trip]").focus();
        return;
      }
      const confirm = event.target.closest("[data-remove-confirm]");
      if (!confirm) return;
      window.WWAccounts.removeItinerary(confirm.getAttribute("data-remove-confirm"));
      renderItinerary();
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    initAuthSlideFallback();
    wireNextLinks();
    const signIn = document.getElementById("sign-in-form");
    const signUp = document.getElementById("sign-up-form");
    if ((signIn || signUp) && window.WWAccounts.current()) {
      goNext();
      return;
    }
    if (signIn) bindAuthForm(signIn, "sign-in");
    if (signUp) bindAuthForm(signUp, "sign-up");
    initItinerary();
  });
})();
