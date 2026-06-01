const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8888;

app.use(cors());
app.use(express.json({ limit: "50mb" }));

// Serve TUI frontend
app.use("/tui", express.static(__dirname));
app.get("/tui", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/", (req, res) => res.redirect("/tui"));

// Health
app.get("/api/health", (req, res) => res.json({ status: "ok", ts: Date.now() }));

// Chat - uses OpenRouter API
app.post("/api/chat", async (req, res) => {
    try {
        const { message, messages, model, imageBase64 } = req.body;
        if (!message && !imageBase64) {
            return res.status(400).json({ error: "Message or image required" });
        }

        const apiKey = process.env.OPENROUTER_API_KEY;
        if (!apiKey) {
            return res.json({
                response: "⚠️ ต้องตั้งค่า OPENROUTER_API_KEY ที่ Render Environment Variables\n\n1. ไปที่ Render Dashboard → sebastian-tui → Settings → Environment\n2. เพิ่ม OPENROUTER_API_KEY = sk-or-v1-...\n3. กด Save → Redeploy",
                model: "fallback"
            });
        }

        const useModel = model && model !== "auto" ? model : "meta-llama/llama-3.2-11b-vision-instruct:free";

        const msgs = [
            { role: "system", content: "คุณคือ Sebastian ผู้ช่วย AI ส่วนตัวของ Diamond ตอบเป็นภาษาไทย สุภาพ เป็นกันเอง ช่วยเหลือด้านโปรเจกต์ Sebastian YouTube Etsy และงานคลินิกออร์โธติกส์" }
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

        const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": "Bearer " + apiKey,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://sebastian-tui.onrender.com",
                "X-Title": "Sebastian AI"
            },
            body: JSON.stringify({ model: useModel, messages: msgs }),
            signal: AbortSignal.timeout(60000),
        });

        if (!resp.ok) {
            const errText = await resp.text();
            return res.json({ response: "⚠️ OpenRouter error: " + resp.status + " " + errText.substring(0, 200) });
        }

        const data = await resp.json();
        const reply = data.choices?.[0]?.message?.content || "ไม่ได้รับคำตอบ";
        res.json({ response: reply, model: useModel });
    } catch (err) {
        console.error("chat error:", err);
        res.json({ response: "⚠️ ข้อผิดพลาด: " + err.message });
    }
});

app.listen(PORT, () => console.log("Sebastian TUI on port " + PORT));