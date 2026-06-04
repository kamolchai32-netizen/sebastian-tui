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

// Helper: HTTP request
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

// ===== GOOGLE SHEETS API =====
async function sheetsRead(spreadsheetId, range) {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) return { error: "GOOGLE_API_KEY not set" };
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?key=${apiKey}`;
    const result = await httpRequest(url, { method: "GET" });
    return result.data;
}

async function sheetsWrite(spreadsheetId, range, values) {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) return { error: "GOOGLE_API_KEY not set" };
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=RAW&key=${apiKey}`;
    const body = JSON.stringify({ values });
    const result = await httpRequest(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
    }, body);
    return result.data;
}

// ===== GOOGLE CALENDAR API =====
async function calendarList() {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) return { error: "GOOGLE_API_KEY not set" };
    const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?key=${apiKey}&maxResults=10&orderBy=startTime&singleEvents=true&timeMin=${new Date().toISOString()}`;
    const result = await httpRequest(url, { method: "GET" });
    return result.data;
}

// ===== TELEGRAM WEBHOOK =====
app.post("/telegram/webhook", async (req, res) => {
    try {
        const update = req.body;
        if (!update.message) return res.sendStatus(200);
        const chatId = update.message.chat.id;
        const text = update.message.text || "";
        const photo = update.message.photo;
        console.log("telegram:", chatId, text.substring(0, 50));

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

        const reply = await callAI(text || "สวัสดี", imageBase64);
        await httpRequest(`${TELEGRAM_API}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" }
        }, JSON.stringify({ chat_id: chatId, text: reply }));
        res.sendStatus(200);
    } catch (err) {
        console.error("telegram error:", err.message);
        res.sendStatus(200);
    }
});

app.get("/telegram/setup", async (req, res) => {
    const webhookUrl = `https://sebastian-tui.onrender.com/telegram/webhook`;
    const data = await httpRequest(`${TELEGRAM_API}/setWebhook?url=${webhookUrl}`, { method: "GET" });
    res.json(data.data);
});

// ===== AI CALL =====
async function callAI(message, imageBase64) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return "⚠️ ต้องตั้งค่า OPENROUTER_API_KEY";

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

    const body = JSON.stringify({ model: "moonshotai/kimi-k2.6:free", messages: msgs });
    const result = await httpRequest("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
    }, body);

    if (result.data && result.data.choices && result.data.choices[0]) return result.data.choices[0].message.content;
    if (result.data && result.data.error) return "⚠️ " + (result.data.error.message || JSON.stringify(result.data.error));
    return "⚠️ ไม่ได้รับคำตอบ: " + JSON.stringify(result.data).substring(0, 200);
}

// ===== CHAT API =====
app.post("/api/chat", async (req, res) => {
    try {
        const { message, imageBase64 } = req.body;
        if (!message && !imageBase64) return res.json({ response: "กรุณาพิมพ์ข้อความ" });
        const reply = await callAI(message || "สวัสดี", imageBase64);
        res.json({ response: reply });
    } catch (err) {
        res.json({ response: "⚠️ " + err.message });
    }
});

// ===== GOOGLE SHEETS API =====
app.get("/api/sheets/read", async (req, res) => {
    try {
        const { spreadsheetId, range } = req.query;
        const data = await sheetsRead(spreadsheetId, range || "A1:Z100");
        res.json(data);
    } catch (err) { res.json({ error: err.message }); }
});

app.post("/api/sheets/write", async (req, res) => {
    try {
        const { spreadsheetId, range, values } = req.body;
        const data = await sheetsWrite(spreadsheetId, range, values);
        res.json(data);
    } catch (err) { res.json({ error: err.message }); }
});

// ===== GOOGLE CALENDAR API =====
app.get("/api/calendar/events", async (req, res) => {
    try {
        const data = await calendarList();
        res.json(data);
    } catch (err) { res.json({ error: err.message }); }
});

app.listen(PORT, () => {
    console.log("Sebastian TUI v5 on port " + PORT);
    console.log("OPENROUTER_API_KEY:", process.env.OPENROUTER_API_KEY ? "SET" : "MISSING");
    console.log("GOOGLE_API_KEY:", process.env.GOOGLE_API_KEY ? "SET" : "MISSING");
});