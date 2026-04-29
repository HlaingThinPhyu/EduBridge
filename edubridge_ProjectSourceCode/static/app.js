const API_BASE = "";

function getQueryParam(name) {
  const url = new URL(window.location.href);
  return url.searchParams.get(name);
}

// ---------- IndexedDB ----------
const DB_NAME = "edubridge_db";
const DB_VERSION = 2;
let dbInstance = null;

function openDatabase() {
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Cache for lessons
      if (!db.objectStoreNames.contains("lessons")) {
        db.createObjectStore("lessons", { keyPath: "id" });
      }

      // Offline progress store
      if (!db.objectStoreNames.contains("offline_progress")) {
        db.createObjectStore("offline_progress", {
          keyPath: "local_id",
          autoIncrement: true,
        });
      }

      // Local users
      if (!db.objectStoreNames.contains("local_users")) {
        db.createObjectStore("local_users", { keyPath: "username" });
      }

      // Offline lesson materials + videos (files)
      if (!db.objectStoreNames.contains("files")) {
        db.createObjectStore("files", { keyPath: "id" });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      console.error("IndexedDB open error:", event);
      reject(event);
    };
  });
}

// ---------- Local users: register / query / current ----------

function saveLocalUser(user) {
  return openDatabase().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction("local_users", "readwrite");
      const store = tx.objectStore("local_users");
      const req = store.add(user);
      req.onsuccess = () => resolve();
      req.onerror = (e) => reject(e);
    });
  });
}

function getLocalUser(username) {
  return openDatabase().then((db) => {
    return new Promise((resolve) => {
      const tx = db.transaction("local_users", "readonly");
      const store = tx.objectStore("local_users");
      const req = store.get(username);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  });
}

function setCurrentUser(user) {
  // user: { username, role }
  localStorage.setItem("currentUser", JSON.stringify(user));
}

function getCurrentUser() {
  const raw = localStorage.getItem("currentUser");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error("Failed to parse currentUser from localStorage", e);
    return null;
  }
}

function getCurrentUsername() {
  const u = getCurrentUser();
  return u ? u.username : null;
}

function getCurrentRole() {
  const u = getCurrentUser();
  return u && u.role ? u.role : "student";
}

function clearCurrentUser() {
  localStorage.removeItem("currentUser");
}

// ---------- IndexedDB helpers ----------

function saveLessonsToDB(lessons) {
  return openDatabase().then((db) => {
    return new Promise((resolve) => {
      const tx = db.transaction("lessons", "readwrite");
      const store = tx.objectStore("lessons");
      lessons.forEach((lesson) => {
        store.put(lesson);
      });
      tx.oncomplete = () => resolve();
    });
  });
}

function getAllLessonsFromDB() {
  return openDatabase().then((db) => {
    return new Promise((resolve) => {
      const tx = db.transaction("lessons", "readonly");
      const store = tx.objectStore("lessons");
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
    });
  });
}

function getLessonFromDB(id) {
  return openDatabase().then((db) => {
    return new Promise((resolve) => {
      const tx = db.transaction("lessons", "readonly");
      const store = tx.objectStore("lessons");
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
    });
  });
}

function addOfflineProgress(progress) {
  return openDatabase().then((db) => {
    return new Promise((resolve) => {
      const tx = db.transaction("offline_progress", "readwrite");
      const store = tx.objectStore("offline_progress");
      store.add(progress);
      tx.oncomplete = () => resolve();
    });
  });
}

function getAllOfflineProgress() {
  return openDatabase().then((db) => {
    return new Promise((resolve) => {
      const tx = db.transaction("offline_progress", "readonly");
      const store = tx.objectStore("offline_progress");
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
    });
  });
}

function clearOfflineProgress() {
  return openDatabase().then((db) => {
    return new Promise((resolve) => {
      const tx = db.transaction("offline_progress", "readwrite");
      const store = tx.objectStore("offline_progress");
      store.clear();
      tx.oncomplete = () => resolve();
    });
  });
}

function cacheFileOffline(fileId, fileBlob) {
  return openDatabase().then((db) => {
    const tx = db.transaction("files", "readwrite");
    const store = tx.objectStore("files");

    return new Promise((resolve) => {
      store.put({ id: fileId, file: fileBlob });
      tx.oncomplete = () => resolve();
    });
  });
}

function getOfflineFile(fileId) {
  return openDatabase().then((db) => {
    return new Promise((resolve) => {
      const tx = db.transaction("files", "readonly");
      const store = tx.objectStore("files");
      const req = store.get(fileId);

      req.onsuccess = () => resolve(req.result ? req.result.file : null);
      req.onerror = () => resolve(null);
    });
  });
}

// ---------- Network status ----------

function updateNetworkStatus() {
  const el = document.getElementById("networkStatus");
  if (!el) return;

  if (navigator.onLine) {
    el.textContent = "Online";
    el.classList.remove("offline");
    el.classList.add("online");
  } else {
    el.textContent = "Offline";
    el.classList.remove("online");
    el.classList.add("offline");
  }
}

async function syncOfflineProgress() {
  if (!navigator.onLine) return;
  try {
    const items = await getAllOfflineProgress();
    if (items.length === 0) return;

    console.log("Syncing offline progress:", items);
    for (const item of items) {
      await fetch(`${API_BASE}/progress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: item.user_id,
          lesson_id: item.lesson_id,
          completed_at: item.completed_at,
        }),
      });
    }
    await clearOfflineProgress();
    console.log("Offline progress synced.");
  } catch (err) {
    console.error("Failed to sync offline progress:", err);
  }
}

// ---------- Page init ----------

function initPage() {
  updateNetworkStatus();

  window.addEventListener("online", () => {
    updateNetworkStatus();
    syncOfflineProgress();
  });
  window.addEventListener("offline", updateNetworkStatus);

  const pageType = document.body.getAttribute("data-page");

  if (pageType === "login") {
    initLoginPage();
    registerServiceWorker();
    return;
  }
  const currentUser = getCurrentUser();
  if (!currentUser) {
    window.location.href = "/static/login.html";
    return;
  }

  attachUserUI();

  if (pageType === "index") {
    initIndexPage();
  } else if (pageType === "lesson") {
    initLessonPage();
  } else if (pageType === "dashboard") {
    initDashboardPage();
  }

  registerServiceWorker();
}

function attachUserUI() {
  const u = getCurrentUser();
  const label = document.getElementById("currentUserLabel");
  const logoutBtn = document.getElementById("logoutBtn");

  if (label && u) {
    const roleText = u.role === "admin" ? "Admin" : "Student";
    label.textContent = `Hi, ${u.username} (${roleText})`;
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      clearCurrentUser();
      window.location.href = "/static/login.html";
    });
  }
}

// ---------- Login page ----------

function initLoginPage() {
  const form = document.getElementById("loginForm");
  const usernameInput = document.getElementById("loginUsername");
  const passwordInput = document.getElementById("loginPassword");
  const roleSelect = document.getElementById("loginRole");
  const msgEl = document.getElementById("loginMessage");
  const registerBtn = document.getElementById("registerBtn");
  const loginBtn = document.getElementById("loginBtn");

  if (!form) return;

  function showMessage(text) {
    msgEl.textContent = text;
  }

  registerBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();
    const role = roleSelect ? roleSelect.value : "student";

    if (!username || !password) {
      showMessage("Please enter username and password.");
      return;
    }

    const existing = await getLocalUser(username);
    if (existing) {
      showMessage("User already exists. Please login instead.");
      return;
    }

    try {
      const newUser = { username, password, role };
      await saveLocalUser(newUser);
      // save to MongoDB
      await fetch(`${API_BASE}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: username,
          role: role,
          locale: "en"
        })
      });
      setCurrentUser(newUser);
      showMessage("Registered and logged in. Redirecting...");
      window.location.href = "/static/dashboard.html";
    } catch (err) {
      console.error(err);
      showMessage("Failed to register user.");
    }
  });

  loginBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();

    if (!username || !password) {
      showMessage("Please enter username and password.");
      return;
    }

    const user = await getLocalUser(username);
    if (!user) {
      showMessage("User not found. Please register first.");
      return;
    }

    if (user.password !== password) {
      showMessage("Incorrect password.");
      return;
    }

    const role = user.role || "student";
    setCurrentUser({ username, role });
    showMessage("Login successful. Redirecting...");
    window.location.href = "/static/dashboard.html";
  });
}

// ---------- Index page (lesson list + create) ----------

async function initIndexPage() {
  const listEl = document.getElementById("lessonsList");
  const msgEl = document.getElementById("lessonsMessage");
  const createSection = document.getElementById("createLessonSection");
  const createForm = document.getElementById("createLessonForm");
  const createMsgEl = document.getElementById("createLessonMessage");

  const currentRole = getCurrentRole();

  async function loadLessons() {
    listEl.innerHTML = "<p>Loading lessons...</p>";

    try {
      let lessons = [];
      if (navigator.onLine) {
        const res = await fetch(`${API_BASE}/lessons`);
        lessons = await res.json();
        await saveLessonsToDB(lessons);
        msgEl.textContent = "";
      } else {
        lessons = await getAllLessonsFromDB();
        msgEl.textContent =
          "You are offline. Showing cached lessons only (if available).";
      }

      if (!lessons || lessons.length === 0) {
        listEl.innerHTML = "<p>No lessons available yet.</p>";
        return;
      }

      const userId = getCurrentUsername() || "guest";
      let completedLessonIds = new Set();

      if (navigator.onLine) {
        try {
          const progressRes = await fetch(
            `${API_BASE}/users/${userId}/progress`
          );
          if (progressRes.ok) {
            const progressList = await progressRes.json();
            progressList.forEach((p) => {
              completedLessonIds.add(p.lesson_id);
            });
          }
        } catch (err) {
          console.error("Failed to load user progress", err);
        }
      }

      const totalLessons = lessons.length;
      const completedCount = lessons.filter((l) =>
        completedLessonIds.has(l.id)
      ).length;

      lessons = lessons.filter((l) => !completedLessonIds.has(l.id));

      if (totalLessons > 0) {
        msgEl.textContent = `Completed ${completedCount} / ${totalLessons} lessons. ${lessons.length} remaining.`;
      }

      listEl.innerHTML = "";
      lessons.forEach((lesson) => {
        const card = document.createElement("article");
        card.className = "card";

        const title = document.createElement("h3");
        title.textContent = lesson.title;

        const meta = document.createElement("p");
        meta.className = "card-meta";
        meta.textContent = `${lesson.language.toUpperCase()} • ${
          lesson.level
        }`;

        const desc = document.createElement("p");
        desc.className = "card-description";
        desc.textContent = lesson.description || "No description";

        const btn = document.createElement("a");
        btn.className = "primary-btn";
        btn.textContent = "Open Lesson";
        btn.href = `/static/lesson.html?lesson_id=${lesson.id}`;

        card.appendChild(title);
        card.appendChild(meta);
        card.appendChild(desc);
        card.appendChild(btn);

        listEl.appendChild(card);
      });
    } catch (err) {
      console.error(err);
      listEl.innerHTML = "<p>Failed to load lessons.</p>";
      msgEl.textContent = "Please check your connection or try again later.";
    }
  }

  // Non-admin: hide create lesson section
  if (currentRole !== "admin") {
    if (createSection) {
      createSection.style.display = "none";
    }
  } else if (createForm) {
    // Admin: bind submit event
    createForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      if (!navigator.onLine) {
        createMsgEl.textContent = "You must be online to create lessons.";
        return;
      }

      const newLesson = {
        title: document.getElementById("lessonTitleInput").value,
        language:
          document.getElementById("lessonLanguageInput").value || "en",
        level: document.getElementById("lessonLevelInput").value || "beginner",
        description: document.getElementById("lessonDescriptionInput").value,
        content: document.getElementById("lessonContentInput").value,
      };

      const materialInput = document.getElementById("createLessonMaterial");
      const materialFiles = materialInput ? materialInput.files : [];

      const videoInput = document.getElementById("createLessonVideo");
      const videoFile = videoInput ? videoInput.files[0] : null;

      try {
        const res = await fetch(`${API_BASE}/lessons`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newLesson),
        });

        if (!res.ok) {
          throw new Error("Failed to create lesson");
        }

        const createdLesson = await res.json();

        // ---- Upload video if attached (GridFS -> video_file_id) ----
        if (videoFile) {
          const formData = new FormData();
          formData.append("file", videoFile);

          const videoRes = await fetch(
            `${API_BASE}/lessons/${createdLesson.id}/upload_video`,
            { method: "POST", body: formData }
          );

          if (videoRes.ok) {
            const data = await videoRes.json();
            console.log("Video saved:", data);
          }
        }

        // ---- Upload lesson materials if attached ----
        if (materialFiles.length > 0) {
          for (const file of materialFiles) {
            const formData = new FormData();
            formData.append("file", file);

            const uploadRes = await fetch(
              `${API_BASE}/lessons/${createdLesson.id}/upload`,
              { method: "POST", body: formData }
            );

            if (uploadRes.ok) {
              const data = await uploadRes.json();
              await cacheFileOffline(data.file_id, file);
            }
          }
        }

        createMsgEl.textContent = "Lesson created successfully.";
        createForm.reset();
        await loadLessons();
      } catch (err) {
        console.error(err);
        createMsgEl.textContent = "Failed to create lesson.";
      }
    });
  }

  // Initial load
  loadLessons();
}

// ---------- Lesson page ----------

async function initLessonPage() {
  const lessonId = getQueryParam("lesson_id");
  const titleEl = document.getElementById("lessonTitle");
  const metaEl = document.getElementById("lessonMeta");
  const descEl = document.getElementById("lessonDescription");
  const contentEl = document.getElementById("lessonContent");
  const statusEl = document.getElementById("lessonStatusMessage");
  const btn = document.getElementById("completeLessonBtn");

  const editContentEl = document.getElementById("editLessonContent");
  const saveBtn = document.getElementById("saveLessonBtn");
  const saveMsgEl = document.getElementById("saveLessonMessage");

  const currentRole = getCurrentRole();

  // Load materials list (download-only for students)
  if (lessonId) {
    loadLessonMaterials(lessonId);
  }

  if (!lessonId) {
    if (titleEl) titleEl.textContent = "Lesson not found";
    return;
  }

  let lesson = null;
  try {
    if (navigator.onLine) {
      const res = await fetch(`${API_BASE}/lessons/${lessonId}`);
      lesson = await res.json();
      await saveLessonsToDB([lesson]);
    } else {
      lesson = await getLessonFromDB(lessonId);
      if (statusEl) {
        statusEl.textContent =
          "You are offline. Viewing cached version of this lesson (if available).";
      }
    }
  } catch (err) {
    console.error(err);
  }

  if (!lesson) {
    if (titleEl) titleEl.textContent = "Lesson not available";
    return;
  }

  if (titleEl) titleEl.textContent = lesson.title;
  if (metaEl)
    metaEl.textContent = `${lesson.language.toUpperCase()} • ${lesson.level}`;
  if (descEl) descEl.textContent = lesson.description || "";
  if (contentEl) contentEl.textContent = lesson.content || "";

  if (editContentEl) {
    editContentEl.value = lesson.content || "";
  }

  // Mark complete
  if (btn) {
    btn.addEventListener("click", async () => {
      const userId = getCurrentUsername() || "guest";
      const payload = {
        user_id: userId,
        lesson_id: lesson.id,
        completed_at: new Date().toISOString(),
      };

      try {
        if (navigator.onLine) {
          await fetch(`${API_BASE}/progress`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (statusEl) statusEl.textContent = "Progress saved online.";
        } else {
          await addOfflineProgress(payload);
          if (statusEl) {
            statusEl.textContent =
              "You are offline. Progress stored locally and will sync automatically when online.";
          }
        }
        btn.disabled = true;
        btn.textContent = "Completed";
      } catch (err) {
        console.error(err);
        if (statusEl) statusEl.textContent = "Failed to save progress.";
      }
    });
  }

  // Save edited content (admin only via UI)
  if (saveBtn && editContentEl && saveMsgEl) {
    saveBtn.addEventListener("click", async () => {
      if (!navigator.onLine) {
        saveMsgEl.textContent = "Editing requires online connection.";
        return;
      }

      const newContent = editContentEl.value;

      try {
        const res = await fetch(`${API_BASE}/lessons/${lesson.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: newContent }),
        });

        if (!res.ok) {
          throw new Error("Failed to update lesson");
        }

        if (contentEl) contentEl.textContent = newContent;
        saveMsgEl.textContent = "Lesson content updated.";
      } catch (err) {
        console.error(err);
        saveMsgEl.textContent = "Failed to update lesson.";
      }
    });
  }

  // Upload Lesson Material (admin only)
  const uploadBtn = document.getElementById("uploadMaterialBtn");
  const fileInput = document.getElementById("materialInput");
  const uploadMsg = document.getElementById("uploadMaterialMessage");

  if (uploadBtn && fileInput && currentRole === "admin") {
    uploadBtn.addEventListener("click", async () => {
      if (!fileInput.files[0]) {
        if (uploadMsg) uploadMsg.textContent = "Please choose a file first.";
        return;
      }

      if (!navigator.onLine) {
        if (uploadMsg) uploadMsg.textContent = "You must be online to upload.";
        return;
      }

      const file = fileInput.files[0];
      const formData = new FormData();
      formData.append("file", file);

      try {
        const res = await fetch(`${API_BASE}/lessons/${lessonId}/upload`, {
          method: "POST",
          body: formData,
        });

        if (!res.ok) throw new Error("Upload failed");

        const data = await res.json();

        // Cache file locally (for offline use)
        await cacheFileOffline(data.file_id, file);

        if (uploadMsg)
          uploadMsg.textContent = "File uploaded and cached offline.";

        fileInput.value = "";

        // Reload list
        loadLessonMaterials(lessonId);
      } catch (err) {
        console.error(err);
        if (uploadMsg) uploadMsg.textContent = "Upload failed.";
      }
    });
  }

  // Hide admin edit/upload tools for student
  const adminLessonTools = document.getElementById("adminLessonTools");
  if (currentRole !== "admin") {
    if (adminLessonTools) {
      adminLessonTools.style.display = "none";
    }
  }

  // ---- VIDEO DISPLAY (file-based, offline-capable) ----
  const videoSection = document.getElementById("lessonVideoSection");
  const videoPlayer = document.getElementById("lessonVideoPlayer");

  if (lesson.video_file_id && videoSection && videoPlayer) {
    try {
      const videoId = lesson.video_file_id;
      // Try offline cache first
      const offlineVideo = await getOfflineFile(videoId);

      if (offlineVideo) {
        videoPlayer.src = URL.createObjectURL(offlineVideo);
        videoSection.style.display = "block";
      } else if (navigator.onLine) {
            const url = `${API_BASE}/materials/${videoId}`;
            videoPlayer.src = url;
            videoSection.style.display = "block";

            // Cache video for offline
            const res = await fetch(url);
            if (res.ok) {
                const blob = await res.blob();
                await cacheFileOffline(videoId, blob);
            }
        }
    } catch (err) {
      console.error("Failed to load video:", err);
    }
  }

  // ---- VIDEO UPLOAD (admin only) ----
  const videoBtn = document.getElementById("uploadVideoBtn");
  const videoInput = document.getElementById("videoInput");
  const videoMsg = document.getElementById("uploadVideoMsg");
  const adminVideoUpload = document.getElementById("adminVideoUpload");

  if (currentRole === "admin" && videoBtn && videoInput) {
    videoBtn.onclick = async () => {
      if (!videoInput.files[0]) {
        if (videoMsg) videoMsg.textContent = "Select a video file first.";
        return;
      }

      if (!navigator.onLine) {
        if (videoMsg) videoMsg.textContent = "You must be online to upload.";
        return;
      }

      const form = new FormData();
      form.append("file", videoInput.files[0]);

      try {
        const res = await fetch(
          `${API_BASE}/lessons/${lessonId}/upload_video`,
          {
            method: "POST",
            body: form,
          }
        );

        const data = await res.json();

        if (res.ok) {
          if (videoMsg) videoMsg.textContent = "Video uploaded successfully";

          // Cache video offline
          const blob = await videoInput.files[0].arrayBuffer().then((ab) => new Blob([ab], { type: videoInput.files[0].type }));
          await cacheFileOffline(data.video_file_id, blob);

          // Reload page to show embedded player
          location.reload();
        } else {
          if (videoMsg) videoMsg.textContent = "Upload failed";
          console.error("Video upload error:", data);
        }
      } catch (err) {
        console.error(err);
        if (videoMsg) videoMsg.textContent = "Upload failed";
      }
    };
  } else {
    if (adminVideoUpload) {
      adminVideoUpload.style.display = "none";
    }
  }
}

// ---------- Load Lesson Materials ----------

async function loadLessonMaterials(lessonId) {
  const container = document.getElementById("materialsList");
  if (!container) return;

  container.innerHTML = "<p>Loading materials...</p>";

  try {
    const res = await fetch(`${API_BASE}/lessons/${lessonId}/full`);
    if (!res.ok) throw new Error("Failed to load materials");

    const data = await res.json();
    const materials = data.materials || [];

    if (materials.length === 0) {
      container.innerHTML = "<p>No materials for this lesson.</p>";
      return;
    }

    container.innerHTML = "";

    materials.forEach((m) => {
      const div = document.createElement("div");
      div.className = "material-item";

      const name = document.createElement("p");
      name.textContent = m.filename;

      const btn = document.createElement("button");
      btn.textContent = "Download";
      btn.className = "primary-btn";
      btn.onclick = () => downloadMaterial(m.file_id, m.filename);

      div.appendChild(name);
      div.appendChild(btn);
      container.appendChild(div);
    });
  } catch (err) {
    console.error(err);
    container.innerHTML = "<p>Failed to load materials.</p>";
  }
}

// ---------- Dashboard page ----------

async function initDashboardPage() {
  const completedEl = document.getElementById("completedLessons");
  const pendingEl = document.getElementById("pendingLessons");
  const summaryEl = document.getElementById("dashboardSummary");
  const statsBody = document.getElementById("statsTableBody");
  const statsMsgEl = document.getElementById("statsMessage");

  if (!completedEl || !pendingEl) return;

  const userId = getCurrentUsername() || "guest";

  if (!navigator.onLine) {
    if (summaryEl) {
      summaryEl.textContent =
        "You are offline. Please go online to view your dashboard.";
    }
    completedEl.innerHTML = "<p>Completed lessons not available offline.</p>";
    pendingEl.innerHTML = "<p>Pending lessons not available offline.</p>";

    if (statsBody) {
      statsBody.innerHTML =
        "<tr><td colspan='2'>Stats not available offline.</td></tr>";
    }
    if (statsMsgEl) {
      statsMsgEl.textContent =
        "Please go online to view overall lesson statistics.";
    }
    return;
  }

  try {
    const [lessonsRes, progressRes, statsRes] = await Promise.all([
      fetch(`${API_BASE}/lessons`),
      fetch(`${API_BASE}/users/${userId}/progress`),
      fetch(`${API_BASE}/stats/lessons`),
    ]);

    if (!lessonsRes.ok || !progressRes.ok || !statsRes.ok) {
      throw new Error("Dashboard API error");
    }

    const [lessons, progressList, stats] = await Promise.all([
      lessonsRes.json(),
      progressRes.json(),
      statsRes.json(),
    ]);

    const completedIds = new Set(progressList.map((p) => p.lesson_id));
    const completedLessons = lessons.filter((l) => completedIds.has(l.id));
    const pendingLessons = lessons.filter((l) => !completedIds.has(l.id));

    const total = lessons.length;
    const completedCount = completedLessons.length;
    const pendingCount = pendingLessons.length;

    if (summaryEl) {
      if (total === 0) {
        summaryEl.textContent = "No lessons created yet.";
      } else {
        summaryEl.textContent = `You have completed ${completedCount} of ${total} lessons. ${pendingCount} remaining.`;
      }
    }

    function renderLessonList(container, items, emptyText) {
      container.innerHTML = "";
      if (!items || items.length === 0) {
        container.innerHTML = `<p>${emptyText}</p>`;
        return;
      }

      items.forEach((lesson) => {
        const card = document.createElement("article");
        card.className = "card";

        const title = document.createElement("h3");
        title.textContent = lesson.title;

        const meta = document.createElement("p");
        meta.className = "card-meta";
        meta.textContent = `${lesson.language.toUpperCase()} • ${
          lesson.level
        }`;

        const btn = document.createElement("a");
        btn.className = "primary-btn";
        btn.textContent = "Open Lesson";
        btn.href = `/static/lesson.html?lesson_id=${lesson.id}`;

        card.appendChild(title);
        card.appendChild(meta);
        card.appendChild(btn);

        container.appendChild(card);
      });
    }

    renderLessonList(
      completedEl,
      completedLessons,
      "No completed lessons yet."
    );
    renderLessonList(
      pendingEl,
      pendingLessons,
      "All lessons completed! 🎉"
    );

    if (statsBody) {
      const lessonMap = {};
      lessons.forEach((l) => {
        lessonMap[l.id] = l;
      });

      statsBody.innerHTML = "";
      if (!stats || stats.length === 0) {
        statsBody.innerHTML =
          "<tr><td colspan='2'>No completion stats yet.</td></tr>";
      } else {
        stats.forEach((s) => {
          const tr = document.createElement("tr");
          const titleTd = document.createElement("td");
          const countTd = document.createElement("td");

          const lesson = lessonMap[s.lesson_id];
          titleTd.textContent = lesson ? lesson.title : s.lesson_id;
          countTd.textContent = s.completions;

          tr.appendChild(titleTd);
          tr.appendChild(countTd);
          statsBody.appendChild(tr);
        });
      }

      if (statsMsgEl) {
        statsMsgEl.textContent = "";
      }
    }
  } catch (err) {
    console.error(err);
    if (summaryEl) {
      summaryEl.textContent = "Failed to load dashboard data.";
    }
    completedEl.innerHTML = "<p>Error loading data.</p>";
    pendingEl.innerHTML = "<p>Error loading data.</p>";

    if (statsBody) {
      statsBody.innerHTML = "<tr><td colspan='2'>No stats.</td></tr>";
    }
    if (statsMsgEl) {
      statsMsgEl.textContent =
        "Please check your connection or try again later.";
    }
  }
}

// ---------- PWA ----------

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("/static/sw.js")
      .then(() => console.log("Service worker registered"))
      .catch((err) => console.error("SW registration failed:", err));
  }
}

// ---------- Download with offline fallback ----------

async function downloadMaterial(fileId, filename) {
  try {
    if (navigator.onLine) {
      const res = await fetch(`${API_BASE}/materials/${fileId}`, {
        cache: "no-store"
      });
      if (!res.ok) throw new Error("Failed to download file");

      const blob = await res.blob();
      saveFile(blob, filename);

      await cacheFileOffline(fileId, blob);
      return;
    }

    const offlineBlob = await getOfflineFile(fileId);

    if (offlineBlob) {
      saveFile(offlineBlob, filename);
    } else {
      alert("This file is not available offline.");
    }
  } catch (err) {
    console.error(err);
    alert("Could not download file.");
  }
}

function saveFile(blob, filename) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
}

document.addEventListener("DOMContentLoaded", initPage);
