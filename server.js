const express = require("express");
const cors = require("cors");
const path = require("path");
const fetch = require("node:http");

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

app.use("/tui", express.static(__dirname, { etag: false, lastModified: false, cacheControl: false, maxAge: 0 }));
app.get("/tui", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/", (req, res) => res.redirect("/tui"));

app.get("/api/health", (req, res) => res.json({ status: "ok", ts: Date.now() }));

// ===== TELEGRAM WEBHOOK =====
app.post("/telegram/webhook", async (req, res) => {
    try {
        const update = req.body;
        if (!update.message) return res.sendStatus(200);

        const chatId = update.message.chat.id;
        const text = update.message.text || "";
        const photo = update.message.photo;

        console.log("telegram msg:", chatId, text.substring(0, 50));

        // Get image if present
        let imageBase64 = null;
        if (photo && photo.length > 0) {
            const fileId = photo[photo.length - 1].file_id;
            const fileResp = await fetch(`${TELEGRAM_API}/getFile?file_id=${fileId}`);
            const fileData = await fileResp.json();
            if (fileData.ok) {
                const filePath = fileData.result.file_path;
                const imgResp = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`);
                const imgBuffer = await imgResp.arrayBuffer();
                imageBase64 = "data:image/jpeg;base64," + Buffer.from(imgBuffer).toString("base64");
            }
        }

        // Call AI
        const msgs = [
            { role: "system", content: "คุณคือ Sebastian ผู้ช่วย AI ส่วนตัวของ Diamond ตอบเป็นภาษาไทย สุภาพ เป็นกันเอง ช่วยเหลือด้านโปรเจกต์ Sebastian YouTube Etsy และงานคลินิกออร์โธติกส์" }
        ];
        if (imageBase64) {
            msgs.push({ role: "user", content: [{ type: "text", text: text || "บอกอะไรหน่อยเกี่ยวกับรูปนี้" }, { type: "image_url", image_url: { url: imageBase64 } }] });
        } else {
            msgs.push({ role: "user", content: text });
        }

        const aiResp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": "Bearer " + (process.env.OPENROUTER_API_KEY || ""),
                "Content-Type": "application/json",
                "HTTP-Referer": "https://sebastian-tui.onrender.com",
                "X-Title": "Sebastian AI"
            },
            body: JSON.stringify({ model: "nvidia/nemotron-3-super-120b-a12b:free", messages: msgs }),
            signal: AbortSignal.timeout(60000),
        });

        let reply = "⚠️ ไม่สามารถตอบได้";
        if (aiResp.ok) {
            const data = await aiResp.json();
            reply = data.choices?.[0]?.message?.content || reply;
        }

        // Send reply to Telegram
        await fetch(`${TELEGRAM_API}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text: reply }),
        });

        res.sendStatus(200);
    } catch (err) {
        console.error("telegram error:", err);
        res.sendStatus(200);
    }
});

// Set webhook
app.get("/telegram/setup", async (req, res) => {
    const webhookUrl = `https://sebastian-tui.onrender.com/telegram/webhook`;
    const resp = await fetch(`${TELEGRAM_API}/setWebhook?url=${webhookUrl}`);
    const data = await resp.json();
    res.json(data);
});

// ===== CHAT API (for TUI web) =====
const LOCAL_MODELS = ["llama3.2:3b", "gemma4:e2b", "llava:7b"];
const DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";

app.post("/api/chat", async (req, res) => {
    try {
        const { message, messages, model, imageBase64 } = req.body;
        if (!message && !imageBase64) return res.json({ response: "กรุณาพิมพ์ข้อความก่อน" });

        const useModel = model && model !== "auto" ? model : DEFAULT_MODEL;
        const isLocal = LOCAL_MODELS.includes(useModel);

        const msgs = [
            { role: "system", content: "คุณคือ Sebastian ผู้ช่วย AI ส่วนตัวของ Diamond ตอบเป็นภาษาไทย สุภาพ เป็นกันเอง" }
        ];
        if (messages && messages.length > 0) {
            messages.slice(-8).forEach(m => {
                if ((m.role === "user" || m.role === "assistant") && m.content && !m.content.startsWith("[")) {
                    msgs.push({ role: m.role, content: m.content });
                }
            });
        }
        if (imageBase64) {
            const parts = [];
            if (message) parts.push({ type: "text", text: message });
            else parts.push({ type: "text", text: "บอกอะไรหน่อยเกี่ยวกับรูปนี้" });
            parts.push({ type: "image_url", image_url: { url: imageBase64 } });
            msgs.push({ role: "user", content: parts });
        } else {
            msgs.push({ role: "user", content: message || "สวัสดี" });
        }

        const apiKey = process.env.OPENROUTER_API_KEY;
        if (!apiKey) return res.json({ response: "⚠️ ต้องตั้งค่า OPENROUTER_API_KEY" });

        const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
            body: JSON.stringify({ model: useModel, messages: msgs }),
            signal: AbortSignal.timeout(60000),
        });

        if (!resp.ok) {
            const errText = await resp.text();
            return res.json({ response: "⚠️ " + resp.status + ": " + errText.substring(0, 200) });
        }

        const data = await resp.json();
        res.json({ response: data.choices?.[0]?.message?.content || "ไม่ได้รับคำตอบ", model: useModel });
    } catch (err) {
        res.json({ response: "⚠️ " + err.message });
    }
});

app.listen(PORT, () => console.log("Sebastian TUI v3 + Telegram on port " + PORT));