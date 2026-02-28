const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 4000);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:3000";
const SESSION_COOKIE = "hireme_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const dataDir = path.join(process.cwd(), "data");
const usersFile = path.join(dataDir, "users.json");
const sessionsFile = path.join(dataDir, "sessions.json");
const requirementsFile = path.join(dataDir, "requirements.json");
const chatsFile = path.join(dataDir, "chats.json");

async function ensureDataFiles() {
  await fs.mkdir(dataDir, { recursive: true });
  const files = [
    [usersFile, "[]"],
    [sessionsFile, "[]"],
    [requirementsFile, "[]"],
    [chatsFile, "[]"],
  ];
  await Promise.all(
    files.map(async ([file, content]) => {
      try {
        await fs.access(file);
      } catch {
        await fs.writeFile(file, content, "utf8");
      }
    }),
  );
}

async function readJson(file) {
  await ensureDataFiles();
  const raw = await fs.readFile(file, "utf8");
  return JSON.parse(raw);
}

async function writeJson(file, value) {
  await ensureDataFiles();
  await fs.writeFile(file, JSON.stringify(value, null, 2), "utf8");
}

function sendJson(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": FRONTEND_ORIGIN,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    ...extraHeaders,
  });
  res.end(JSON.stringify(body));
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const cookies = {};
  header.split(";").forEach((cookie) => {
    const [key, ...value] = cookie.trim().split("=");
    if (key) cookies[key] = decodeURIComponent(value.join("="));
  });
  return cookies;
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function normalizeUserInput(input) {
  return {
    name: String(input.name || "").trim(),
    email: String(input.email || "").trim().toLowerCase(),
    phone: String(input.phone || "").trim(),
    password: String(input.password || ""),
    userType: input.userType === "hirer" ? "hirer" : "freelancer",
  };
}

function validateUserInput(input) {
  if (!input.name) return "Name is required.";
  if (!input.email || !input.email.includes("@")) return "Valid email is required.";
  if (!input.phone || input.phone.length < 8) return "Valid phone number is required.";
  if (!input.password || input.password.length < 6) return "Password must be at least 6 characters.";
  if (!["hirer", "freelancer"].includes(input.userType)) return "User type must be hirer or freelancer.";
  return null;
}

function normalizeLoginInput(input) {
  return {
    email: String(input.email || "").trim().toLowerCase(),
    password: String(input.password || ""),
  };
}

function validateLoginInput(input) {
  if (!input.email || !input.email.includes("@")) return "Valid email is required.";
  if (!input.password) return "Password is required.";
  return null;
}

function normalizeProfileInput(input) {
  return {
    name: String(input.name || "").trim(),
    phone: String(input.phone || "").trim(),
  };
}

function validateProfileInput(input) {
  if (!input.name) return "Name is required.";
  if (!input.phone || input.phone.length < 8) return "Valid phone number is required.";
  return null;
}

function sanitizeUser(user) {
  if (!user) return null;
  const { password, ...safeUser } = user;
  return safeUser;
}

function normalizeRequirementInput(input) {
  return {
    title: String(input.title || "").trim(),
    description: String(input.description || "").trim(),
    budget: String(input.budget || "").trim(),
    skills: String(input.skills || "").trim(),
    location: String(input.location || "").trim(),
  };
}

function validateRequirementInput(input) {
  if (!input.title) return "Title is required.";
  if (!input.description || input.description.length < 20) return "Description must be at least 20 characters.";
  if (!input.budget) return "Budget is required.";
  if (!input.skills) return "At least one skill is required.";
  if (!input.location) return "Location is required.";
  return null;
}

function normalizeChatMessageInput(input) {
  return {
    text: String(input.text || "").trim(),
  };
}

function validateChatMessageInput(input) {
  if (!input.text) return "Message is required.";
  if (input.text.length > 1000) return "Message is too long.";
  return null;
}

function withRequirementDefaults(requirement) {
  return {
    ...requirement,
    status: requirement.status === "accepted" ? "accepted" : "active",
    acceptedFreelancerId: requirement.acceptedFreelancerId || null,
    acceptedAt: requirement.acceptedAt || null,
  };
}

function withRequirementUsers(requirement, users) {
  const normalized = withRequirementDefaults(requirement);
  const hirer = users.find((item) => item.id === normalized.hirerId);
  const acceptedFreelancer = users.find((item) => item.id === normalized.acceptedFreelancerId);

  return {
    ...normalized,
    hirerName: hirer?.name || "Unknown",
    acceptedFreelancerName: acceptedFreelancer?.name || null,
  };
}

function mapThread(thread, users, requirements) {
  const hirer = users.find((item) => item.id === thread.hirerId);
  const freelancer = users.find((item) => item.id === thread.freelancerId);
  const requirement = requirements.find((item) => item.id === thread.requirementId);
  const lastMessage = thread.messages[thread.messages.length - 1] || null;

  return {
    id: thread.id,
    requirementId: thread.requirementId,
    requirementTitle: requirement?.title || "Requirement",
    hirerId: thread.hirerId,
    hirerName: hirer?.name || "Hirer",
    freelancerId: thread.freelancerId,
    freelancerName: freelancer?.name || "Freelancer",
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    lastMessage: lastMessage ? lastMessage.text : "",
    lastMessageAt: lastMessage ? lastMessage.createdAt : thread.updatedAt,
  };
}

function mapThreadDetail(thread, users, requirements) {
  const base = mapThread(thread, users, requirements);
  return {
    ...base,
    messages: thread.messages.map((message) => {
      const sender = users.find((item) => item.id === message.senderId);
      return {
        ...message,
        senderName: sender?.name || "User",
      };
    }),
  };
}

async function getActiveSession(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) return { session: null, user: null };

  const now = Date.now();
  const [sessions, users] = await Promise.all([readJson(sessionsFile), readJson(usersFile)]);
  const validSessions = sessions.filter((entry) => new Date(entry.expiresAt).getTime() > now);
  if (validSessions.length !== sessions.length) {
    await writeJson(sessionsFile, validSessions);
  }
  const session = validSessions.find((entry) => entry.token === token);
  if (!session) return { session: null, user: null };
  const user = users.find((entry) => entry.id === session.userId) || null;
  return { session, user };
}

function buildSessionCookie(token, maxAgeSeconds) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

async function handleSignup(req, res) {
  const body = await readRequestBody(req);
  const input = normalizeUserInput(body);
  const validationError = validateUserInput(input);
  if (validationError) {
    sendJson(res, 400, { error: validationError });
    return;
  }

  const users = await readJson(usersFile);
  const exists = users.some((user) => user.email === input.email || user.phone === input.phone);
  if (exists) {
    sendJson(res, 409, { error: "User already exists with this email or phone." });
    return;
  }

  const user = {
    id: crypto.randomUUID(),
    name: input.name,
    email: input.email,
    phone: input.phone,
    password: input.password,
    userType: input.userType,
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  await writeJson(usersFile, users);

  const session = {
    token: crypto.randomBytes(32).toString("hex"),
    userId: user.id,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  };
  const sessions = await readJson(sessionsFile);
  sessions.push(session);
  await writeJson(sessionsFile, sessions);

  sendJson(
    res,
    201,
    { user: sanitizeUser(user) },
    { "Set-Cookie": buildSessionCookie(session.token, Math.floor(SESSION_TTL_MS / 1000)) },
  );
}

async function handleLogin(req, res) {
  const body = await readRequestBody(req);
  const input = normalizeLoginInput(body);
  const validationError = validateLoginInput(input);
  if (validationError) {
    sendJson(res, 400, { error: validationError });
    return;
  }

  const users = await readJson(usersFile);
  const user = users.find((entry) => entry.email === input.email);
  const isPasswordValid =
    user && (entryHasPassword(user) ? user.password === input.password : user.phone === input.password);

  if (!user || !isPasswordValid) {
    sendJson(res, 401, { error: "Invalid credentials. Check email/password." });
    return;
  }

  const session = {
    token: crypto.randomBytes(32).toString("hex"),
    userId: user.id,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  };
  const sessions = await readJson(sessionsFile);
  sessions.push(session);
  await writeJson(sessionsFile, sessions);

  sendJson(
    res,
    200,
    { user: sanitizeUser(user) },
    { "Set-Cookie": buildSessionCookie(session.token, Math.floor(SESSION_TTL_MS / 1000)) },
  );
}

function entryHasPassword(user) {
  return typeof user.password === "string" && user.password.length > 0;
}

async function handleLogout(req, res) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (token) {
    const sessions = await readJson(sessionsFile);
    await writeJson(
      sessionsFile,
      sessions.filter((entry) => entry.token !== token),
    );
  }
  sendJson(res, 200, { ok: true }, { "Set-Cookie": buildSessionCookie("", 0) });
}

async function handleMe(req, res) {
  const { user } = await getActiveSession(req);
  sendJson(res, 200, { user: sanitizeUser(user) || null });
}

async function handleProfileUpdate(req, res) {
  const { user } = await getActiveSession(req);
  if (!user) {
    sendJson(res, 401, { error: "Login required." });
    return;
  }

  const body = await readRequestBody(req);
  const input = normalizeProfileInput(body);
  const validationError = validateProfileInput(input);
  if (validationError) {
    sendJson(res, 400, { error: validationError });
    return;
  }

  const users = await readJson(usersFile);
  const duplicatePhone = users.some((item) => item.phone === input.phone && item.id !== user.id);
  if (duplicatePhone) {
    sendJson(res, 409, { error: "Phone number already exists for another account." });
    return;
  }

  const index = users.findIndex((item) => item.id === user.id);
  if (index === -1) {
    sendJson(res, 404, { error: "User not found." });
    return;
  }

  const updatedUser = {
    ...users[index],
    name: input.name,
    phone: input.phone,
  };
  users[index] = updatedUser;
  await writeJson(usersFile, users);

  sendJson(res, 200, { user: sanitizeUser(updatedUser) });
}

async function handleRequirementsGet(req, res) {
  const { user } = await getActiveSession(req);
  if (!user) {
    sendJson(res, 401, { error: "Login required." });
    return;
  }

  const [requirements, users] = await Promise.all([readJson(requirementsFile), readJson(usersFile)]);
  const mapped = requirements
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((reqItem) => withRequirementUsers(reqItem, users));
  sendJson(res, 200, { requirements: mapped });
}

async function handleRequirementsPost(req, res) {
  const { user } = await getActiveSession(req);
  if (!user) {
    sendJson(res, 401, { error: "Login required." });
    return;
  }
  if (user.userType !== "hirer") {
    sendJson(res, 403, { error: "Only hirer users can post requirements." });
    return;
  }

  const body = await readRequestBody(req);
  const input = normalizeRequirementInput(body);
  const validationError = validateRequirementInput(input);
  if (validationError) {
    sendJson(res, 400, { error: validationError });
    return;
  }

  const requirement = {
    id: crypto.randomUUID(),
    hirerId: user.id,
    title: input.title,
    description: input.description,
    budget: input.budget,
    skills: input.skills
      .split(",")
      .map((skill) => skill.trim())
      .filter(Boolean),
    location: input.location,
    status: "active",
    acceptedFreelancerId: null,
    acceptedAt: null,
    createdAt: new Date().toISOString(),
  };

  const requirements = await readJson(requirementsFile);
  requirements.push(requirement);
  await writeJson(requirementsFile, requirements);
  sendJson(res, 201, { requirement });
}

async function handleRequirementById(req, res, id) {
  const { user } = await getActiveSession(req);
  if (!user) {
    sendJson(res, 401, { error: "Login required." });
    return;
  }

  const [requirements, users] = await Promise.all([readJson(requirementsFile), readJson(usersFile)]);
  const requirement = requirements.find((item) => item.id === id);
  if (!requirement) {
    sendJson(res, 404, { error: "Requirement not found." });
    return;
  }
  sendJson(res, 200, { requirement: withRequirementUsers(requirement, users) });
}

async function handleRequirementAccept(req, res, id) {
  const { user } = await getActiveSession(req);
  if (!user) {
    sendJson(res, 401, { error: "Login required." });
    return;
  }
  if (user.userType !== "freelancer") {
    sendJson(res, 403, { error: "Only freelancer users can accept requirements." });
    return;
  }

  const requirements = await readJson(requirementsFile);
  const index = requirements.findIndex((item) => item.id === id);
  if (index === -1) {
    sendJson(res, 404, { error: "Requirement not found." });
    return;
  }

  const current = withRequirementDefaults(requirements[index]);
  if (current.status === "accepted") {
    sendJson(res, 409, { error: "Requirement already accepted." });
    return;
  }

  const updated = {
    ...current,
    status: "accepted",
    acceptedFreelancerId: user.id,
    acceptedAt: new Date().toISOString(),
  };
  requirements[index] = updated;
  await writeJson(requirementsFile, requirements);

  const users = await readJson(usersFile);
  sendJson(res, 200, { requirement: withRequirementUsers(updated, users) });
}

async function handleRequirementUnaccept(req, res, id) {
  const { user } = await getActiveSession(req);
  if (!user) {
    sendJson(res, 401, { error: "Login required." });
    return;
  }

  const requirements = await readJson(requirementsFile);
  const index = requirements.findIndex((item) => item.id === id);
  if (index === -1) {
    sendJson(res, 404, { error: "Requirement not found." });
    return;
  }

  const current = withRequirementDefaults(requirements[index]);
  if (current.status !== "accepted") {
    sendJson(res, 409, { error: "Requirement is not accepted." });
    return;
  }

  const canUnaccept =
    (user.userType === "freelancer" && current.acceptedFreelancerId === user.id) ||
    (user.userType === "hirer" && current.hirerId === user.id);

  if (!canUnaccept) {
    sendJson(res, 403, { error: "Not allowed to unaccept this requirement." });
    return;
  }

  const updated = {
    ...current,
    status: "active",
    acceptedFreelancerId: null,
    acceptedAt: null,
  };
  requirements[index] = updated;
  await writeJson(requirementsFile, requirements);

  const users = await readJson(usersFile);
  sendJson(res, 200, { requirement: withRequirementUsers(updated, users) });
}

async function handleChatThreadsGet(req, res, url) {
  const { user } = await getActiveSession(req);
  if (!user) {
    sendJson(res, 401, { error: "Login required." });
    return;
  }

  const requirementId = url.searchParams.get("requirementId");
  const [threads, users, requirements] = await Promise.all([
    readJson(chatsFile),
    readJson(usersFile),
    readJson(requirementsFile),
  ]);

  const filtered = threads
    .filter((thread) => thread.hirerId === user.id || thread.freelancerId === user.id)
    .filter((thread) => (requirementId ? thread.requirementId === requirementId : true))
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
    .map((thread) => mapThread(thread, users, requirements));

  sendJson(res, 200, { threads: filtered });
}

async function handleChatThreadCreate(req, res) {
  const { user } = await getActiveSession(req);
  if (!user) {
    sendJson(res, 401, { error: "Login required." });
    return;
  }

  const body = await readRequestBody(req);
  const requirementId = String(body.requirementId || "").trim();
  const requestedFreelancerId = String(body.freelancerId || "").trim();
  if (!requirementId) {
    sendJson(res, 400, { error: "requirementId is required." });
    return;
  }

  const [requirements, users, threads] = await Promise.all([
    readJson(requirementsFile),
    readJson(usersFile),
    readJson(chatsFile),
  ]);
  const requirement = requirements.find((item) => item.id === requirementId);
  if (!requirement) {
    sendJson(res, 404, { error: "Requirement not found." });
    return;
  }

  let hirerId = requirement.hirerId;
  let freelancerId = "";

  if (user.userType === "freelancer") {
    freelancerId = user.id;
  } else if (user.userType === "hirer") {
    if (requirement.hirerId !== user.id) {
      sendJson(res, 403, { error: "Not allowed to open chat for this requirement." });
      return;
    }
    freelancerId = requestedFreelancerId || requirement.acceptedFreelancerId || "";
  }

  if (!freelancerId) {
    sendJson(res, 400, { error: "Freelancer is required to open chat." });
    return;
  }

  const freelancer = users.find((item) => item.id === freelancerId && item.userType === "freelancer");
  if (!freelancer) {
    sendJson(res, 404, { error: "Freelancer not found." });
    return;
  }

  const existing = threads.find(
    (item) => item.requirementId === requirementId && item.hirerId === hirerId && item.freelancerId === freelancerId,
  );
  if (existing) {
    sendJson(res, 200, { thread: mapThread(existing, users, requirements) });
    return;
  }

  const now = new Date().toISOString();
  const created = {
    id: crypto.randomUUID(),
    requirementId,
    hirerId,
    freelancerId,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
  threads.push(created);
  await writeJson(chatsFile, threads);
  sendJson(res, 201, { thread: mapThread(created, users, requirements) });
}

async function handleChatThreadGet(req, res, threadId) {
  const { user } = await getActiveSession(req);
  if (!user) {
    sendJson(res, 401, { error: "Login required." });
    return;
  }

  const [threads, users, requirements] = await Promise.all([
    readJson(chatsFile),
    readJson(usersFile),
    readJson(requirementsFile),
  ]);
  const thread = threads.find((item) => item.id === threadId);
  if (!thread) {
    sendJson(res, 404, { error: "Chat thread not found." });
    return;
  }

  const isParticipant = thread.hirerId === user.id || thread.freelancerId === user.id;
  if (!isParticipant) {
    sendJson(res, 403, { error: "Not allowed to access this chat." });
    return;
  }

  sendJson(res, 200, { thread: mapThreadDetail(thread, users, requirements) });
}

async function handleChatMessagePost(req, res, threadId) {
  const { user } = await getActiveSession(req);
  if (!user) {
    sendJson(res, 401, { error: "Login required." });
    return;
  }

  const threads = await readJson(chatsFile);
  const index = threads.findIndex((item) => item.id === threadId);
  if (index === -1) {
    sendJson(res, 404, { error: "Chat thread not found." });
    return;
  }

  const thread = threads[index];
  const isParticipant = thread.hirerId === user.id || thread.freelancerId === user.id;
  if (!isParticipant) {
    sendJson(res, 403, { error: "Not allowed to send message in this chat." });
    return;
  }

  const body = await readRequestBody(req);
  const input = normalizeChatMessageInput(body);
  const validationError = validateChatMessageInput(input);
  if (validationError) {
    sendJson(res, 400, { error: validationError });
    return;
  }

  const message = {
    id: crypto.randomUUID(),
    senderId: user.id,
    text: input.text,
    createdAt: new Date().toISOString(),
  };
  const updated = {
    ...thread,
    messages: [...(thread.messages || []), message],
    updatedAt: message.createdAt,
  };
  threads[index] = updated;
  await writeJson(chatsFile, threads);

  const users = await readJson(usersFile);
  const sender = users.find((item) => item.id === user.id);
  sendJson(res, 201, { message: { ...message, senderName: sender?.name || "User" } });
}

async function handleDashboardGet(req, res) {
  const { user } = await getActiveSession(req);
  if (!user) {
    sendJson(res, 401, { error: "Login required." });
    return;
  }

  const [requirements, users] = await Promise.all([readJson(requirementsFile), readJson(usersFile)]);
  const normalized = requirements.map((item) => withRequirementUsers(item, users));

  if (user.userType === "hirer") {
    const own = normalized.filter((item) => item.hirerId === user.id);
    const activeRequirements = own
      .filter((item) => item.status === "active")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const acceptedRequirements = own
      .filter((item) => item.status === "accepted")
      .sort((a, b) => (b.acceptedAt || "").localeCompare(a.acceptedAt || ""));

    sendJson(res, 200, {
      user: sanitizeUser(user),
      role: "hirer",
      stats: {
        active: activeRequirements.length,
        accepted: acceptedRequirements.length,
      },
      activeRequirements,
      acceptedRequirements,
    });
    return;
  }

  const activeRequirements = normalized
    .filter((item) => item.status === "active")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const acceptedRequirements = normalized
    .filter((item) => item.acceptedFreelancerId === user.id)
    .sort((a, b) => (b.acceptedAt || "").localeCompare(a.acceptedAt || ""));

  sendJson(res, 200, {
    user: sanitizeUser(user),
    role: "freelancer",
    stats: {
      active: activeRequirements.length,
      accepted: acceptedRequirements.length,
    },
    activeRequirements,
    acceptedRequirements,
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      sendJson(res, 204, {});
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const { pathname } = url;

    if (req.method === "POST" && pathname === "/api/auth/signup") return handleSignup(req, res);
    if (req.method === "POST" && pathname === "/api/auth/login") return handleLogin(req, res);
    if (req.method === "POST" && pathname === "/api/auth/logout") return handleLogout(req, res);
    if (req.method === "GET" && pathname === "/api/auth/me") return handleMe(req, res);
    if (req.method === "PUT" && pathname === "/api/auth/profile") return handleProfileUpdate(req, res);
    if (req.method === "GET" && pathname === "/api/chat/threads") return handleChatThreadsGet(req, res, url);
    if (req.method === "POST" && pathname === "/api/chat/threads") return handleChatThreadCreate(req, res);
    if (req.method === "GET" && pathname.startsWith("/api/chat/threads/")) {
      const threadId = pathname.replace("/api/chat/threads/", "");
      if (threadId.endsWith("/messages")) {
        sendJson(res, 404, { error: "Not found." });
        return;
      }
      return handleChatThreadGet(req, res, threadId);
    }
    if (req.method === "POST" && pathname.startsWith("/api/chat/threads/") && pathname.endsWith("/messages")) {
      const threadId = pathname.replace("/api/chat/threads/", "").replace("/messages", "");
      return handleChatMessagePost(req, res, threadId);
    }
    if (req.method === "GET" && pathname === "/api/dashboard") return handleDashboardGet(req, res);
    if (req.method === "GET" && pathname === "/api/requirements") return handleRequirementsGet(req, res);
    if (req.method === "POST" && pathname === "/api/requirements") return handleRequirementsPost(req, res);
    if (req.method === "POST" && pathname.startsWith("/api/requirements/") && pathname.endsWith("/accept")) {
      const id = pathname.replace("/api/requirements/", "").replace("/accept", "");
      return handleRequirementAccept(req, res, id);
    }
    if (req.method === "POST" && pathname.startsWith("/api/requirements/") && pathname.endsWith("/unaccept")) {
      const id = pathname.replace("/api/requirements/", "").replace("/unaccept", "");
      return handleRequirementUnaccept(req, res, id);
    }
    if (req.method === "GET" && pathname.startsWith("/api/requirements/")) {
      const id = pathname.replace("/api/requirements/", "");
      return handleRequirementById(req, res, id);
    }

    sendJson(res, 404, { error: "Not found." });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Internal server error." });
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`HireMe backend running on http://localhost:${PORT}`);
});
