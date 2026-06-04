const express = require("express");
const cors = require("cors");
const path = require("path");
const https = require("https");
const http = require("http");

const app = express();
const PORT = process.env.PORT || 8888;
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "8819154154:AAFMIFaY__o1CSjA6k2_UVcMDMaqwrGQhyU";
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(function(req, res, next) {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.set("Pragma", "no-cache");
    next();
});

app.use(express.static(__dirname, { etag: false, lastModified: false, cacheControl: false, maxAge: 0 }));
app.get("/tui", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/control", (req, res) => res.sendFile(path.join(__dirname, "control.html")));
app.get("/", (req, res) => res.redirect("/control"));

app.get("/api/health", (req, res) => res.json({ status: "ok", ts: Date.now() }));

function httpRequest(url, options, body) {
    return new Promise((resolve, reject) => {
        const mod = url.startsWith("https") ? https : http;
        const req = mod.request(url, options, (res) => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => {
                try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
                catch { resolve({ status: res.statusCode, data }); }
            });
        });
        req.on("error", reject);
        req.setTimeout(60000, () => { req.destroy(); reject(new Error("timeout")); });
        if (body) req.write(body);
        req.end();
    });
}

function downloadFile(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            const chunks = [];
            res.on("data", chunk => chunks.push(chunk));
            res.on("end", () => resolve(Buffer.concat(chunks).toString("base64")));
        }).on("error", reject);
    });
}

// ===== MULTI-API AI CALL =====
// Auto-failsafe: Gemini → OpenRouter → Ollama
async function callAI(message, imageBase64, preferredModel) {
    const msgs = [
        { role: "system", content: "คุณคือ Sebastian ผู้ช่วย AI ส่วนตัวของ Diamond ตอบเป็นภาษาไทย สุภาพ เป็นกันเอง ช่วยเหลือด้านโปรเจกต์ Sebastian YouTube Etsy และงานคลินิกออร์โธติกส์" }
    ];
    if (imageBase64) {
        msgs.push({ role: "user", content: [
            { type: "text", text: message || "บอกอะไรหน่อยเกี่ยวกับรูปนี้" },
            { type: "image_url", image_url: { url: imageBase64 } }
        ]});
    } else {
        msgs.push({ role: "user", content: message });
    }

    // Determine which API to use based on model
    const LOCAL_MODELS = ["llama3.2:3b", "gemma4:e2b", "llava:7b"];
    const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-3-flash", "gemini-3.1-flash-lite", "gemma-4-26b"];

    let useModel = preferredModel || "gemini-2.5-flash";
    if (useModel === "auto") useModel = "gemini-2.5-flash";

    const isLocal = LOCAL_MODELS.includes(useModel);
    const isGemini = GEMINI_MODELS.includes(useModel) || useModel.startsWith("gemini") || useModel.startsWith("gemma");

    // Try Gemini first (if selected)
    if (isGemini) {
        const geminiKey = process.env.GEMINI_API_KEY || "AIzaSyCgTfx9x7u9vbNpp6ZX14BTI3jaWB8vHiE";
        const geminiModel = useModel.startsWith("gemma") ? "gemma-3-27b-it" : useModel;
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`;

        const geminiBody = {
            contents: [{ parts: [{ text: message }] }],
            systemInstruction: { parts: [{ text: "คุณคือ Sebastian ผู้ช่วย AI ส่วนตัวของ Diamond ตอบเป็นภาษาไทย สุภาพ เป็นกันเอง" }] }
        };

        try {
            const result = await httpRequest(url, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(JSON.stringify(geminiBody)) }
            }, JSON.stringify(geminiBody));

            if (result.data && result.data.candidates && result.data.candidates[0]) {
                return { text: result.data.candidates[0].content.parts[0].text, model: geminiModel, source: "gemini" };
            }
        } catch (e) {
            console.log("Gemini failed:", e.message);
        }
    }

    // Try OpenRouter (fallback)
    const orKey = process.env.OPENROUTER_API_KEY;
    if (orKey && !isLocal) {
        const orModel = useModel === "auto" ? "moonshotai/kimi-k2.6:free" : useModel;
        const body = JSON.stringify({ model: orModel, messages: msgs });
        try {
            const result = await httpRequest("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: { "Authorization": "Bearer " + orKey, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
            }, body);
            if (result.data && result.data.choices && result.data.choices[0]) {
                return { text: result.data.choices[0].message.content, model: orModel, source: "openrouter" };
            }
        } catch (e) {
            console.log("OpenRouter failed:", e.message);
        }
    }

    // Try Ollama (local, last resort)
    if (isLocal) {
        const ollamaUrl = (process.env.OLLAMA_URL || "http://127.0.0.1:11434") + "/api/chat";
        const body = JSON.stringify({ model: useModel, messages: msgs, stream: false });
        try {
            const result = await httpRequest(ollamaUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
            }, body);
            if (result.data && result.data.message) {
                return { text: result.data.message.content, model: useModel, source: "ollama" };
            }
        } catch (e) {
            console.log("Ollama failed:", e.message);
        }
    }

    return { text: "⚠️ ไม่สามารถตอบได้ — ทุก API ล้มเหลว", model: "none", source: "error" };
}

// ===== TELEGRAM WEBHOOK =====
app.post("/telegram/webhook", async (req, res) => {
    try {
        const update = req.body;
        if (!update.message) return res.sendStatus(200);
        const chatId = update.message.chat.id;
        const text = update.message.text || "";
        const photo = update.message.photo;

        let imageBase64 = null;
        if (photo && photo.length > 0) {
            try {
                const fileId = photo[photo.length - 1].file_id;
                const fileData = await httpRequest(`${TELEGRAM_API}/getFile?file_id=${fileId}`, { method: "GET" });
                if (fileData.data && fileData.data.ok) {
                    const filePath = fileData.data.result.file_path;
                    const imgBase64 = await downloadFile(`https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`);
                    imageBase64 = "data:image/jpeg;base64," + imgBase64;
                }
            } catch (e) { console.error("img error:", e.message); }
        }

        const result = await callAI(text || "สวัสดี", imageBase64);
        await httpRequest(`${TELEGRAM_API}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" }
        }, JSON.stringify({ chat_id: chatId, text: result.text }));
        res.sendStatus(200);
    } catch (err) {
        console.error("telegram error:", err.message);
        res.sendStatus(200);
    }
});

app.get("/telegram/setup", async (req, res) => {
    const data = await httpRequest(`${TELEGRAM_API}/setWebhook?url=https://sebastian-tui.onrender.com/telegram/webhook`, { method: "GET" });
    res.json(data.data);
});

// ===== CHAT API =====
app.post("/api/chat", async (req, res) => {
    try {
        const { message, imageBase64, model } = req.body;
        if (!message && !imageBase64) return res.json({ response: "กรุณาพิมพ์ข้อความ" });
        const result = await callAI(message || "สวัสดี", imageBase64, model);
        res.json({ response: result.text, model: result.model, source: result.source });
    } catch (err) {
        res.json({ response: "⚠️ " + err.message });
    }
});

// ===== GOOGLE SHEETS (simple, no OAuth needed if sheet is public) =====
app.get("/api/sheets/:sheetId/:range", async (req, res) => {
    try {
        const { sheetId, range } = req.params;
        const apiKey = process.env.GOOGLE_API_KEY;
        if (!apiKey) return res.json({ error: "GOOGLE_API_KEY not set — ใช้ Make.com แทนได้" });
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?key=${apiKey}`;
        const result = await httpRequest(url, { method: "GET" });
        res.json(result.data);
    } catch (err) { res.json({ error: err.message }); }
});

app.listen(PORT, () => {
    console.log("Sebastian TUI v6 (multi-API) on port " + PORT);
});