const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 8888;

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));

// Serve TUI frontend
const TUI_DIR = path.resolve(__dirname);
app.use("/tui", express.static(TUI_DIR));
app.get("/tui", (req, res) => res.sendFile(path.join(TUI_DIR, "index.html")));
app.get("/", (req, res) => res.redirect("/tui"));

// Health check
app.get("/api/health", (req, res) => {
    res.json({ status: "ok", ts: Date.now() });
});

// Chat endpoint - uses Ollama if available, otherwise returns helpful message
app.post("/api/chat", async function(req, res) {
    try {
        const body = req.body;
        const message = body.message || "";
        const messages = body.messages || [];
        const model = body.model && body.model !== "auto" ? body.model : "llama3.2:3b";
        const imageBase64 = body.imageBase64 || null;

        const ollamaUrl = process.env.OLLAMA_URL || "http://127.0.0.1:11434";

        const msgs = [
            { role: "system", content: "คุณคือ Sebastian ผู้ช่วย AI ส่วนตัวของ Diamond ตอบเป็นภาษาไทย สุภาพ เป็นกันเอง ช่วยเหลือด้านโปรเจกต์ Sebastian YouTube Etsy และงานคลินิกออร์โธติกส์" }
        ];

        if (messages && messages.length > 0) {
            messages.slice(-8).forEach(function(m) {
                if (m.role === "user" || m.role === "assistant") {
                    if (m.content && !m.content.startsWith("[")) {
                        msgs.push({ role: m.role, content: m.content });
                    }
                }
            });
        }

        if (imageBase64) {
            const parts = [];
            if (message) parts.push({ type: "text", text: message });
            else parts.push({ type: "text", text: "บอกอะไรหน่อยเกี่ยวกับรูปนี้" });
            parts.push({ type: "image_url", image_url: imageBase64 });
            msgs.push({ role: "user", content: parts });
        } else {
            msgs.push({ role: "user", content: message });
        }

        const useModel = imageBase64 ? "llava:7b" : model;

        const resp = await fetch(ollamaUrl + "/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: useModel, messages: msgs, stream: false }),
        });

        if (!resp.ok) {
            // Fallback: return a helpful response when Ollama is not available
            return res.json({
                response: "สวัสดีครับ Diamond! ผม Sebastian 👋\n\n⚠️ ขณะนี้ระบบ AI backend ยังไม่ได้เชื่อมต่อ (Ollama ไม่พร้อม)\n\nสิ่งที่คุณสามารถทำได้:\n1. ดาวน์โหลด Ollama จาก https://ollama.com\n2. รัน: ollama pull llama3.2:3b\n3. รัน: ollama serve\n4. เชื่อมต่อกับ Render ผ่าน environment variable OLLAMA_URL\n\nหรือใช้ API key ของ OpenRouter/Anthropic แทน",
                model: "fallback"
            });
        }

        const data = await resp.json();
        const reply = (data.message && data.message.content) ? data.message.content : "ไม่ได้รับคำตอบ";
        res.json({ response: reply, model: useModel });
    } catch (err) {
        console.error("chat error:", err);
        res.json({ response: "⚠️ ข้อผิดพลาด: " + err.message, model: "error" });
    }
});

// Image generation endpoint
app.post("/api/image", async function(req, res) {
    try {
        const { prompt, style } = req.body;
        const leonardoKey = process.env.LEONARDO_API_KEY;

        if (!leonardoKey) {
            return res.json({
                ok: false,
                message: "ต้องตั้งค่า LEONARDO_API_KEY ก่อนใช้งาน",
                prompt: prompt,
                style: style || "cinematic"
            });
        }

        const resp = await fetch("https://cloud.leonardo.ai/api/rest/v1/generations", {
            method: "POST",
            headers: { Authorization: "Bearer " + leonardoKey, "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: prompt + ", " + (style || "cinematic") + " style", num_images: 1 }),
        });
        const data = await resp.json();
        res.json({ ok: true, data: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Start
app.listen(PORT, function() {
    console.log("Sebastian TUI server on port " + PORT);
});