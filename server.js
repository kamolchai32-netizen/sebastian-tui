const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8888;

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

// Model mapping — local models go through Ollama on local machine, cloud models through OpenRouter
const LOCAL_MODELS = ["llama3.2:3b", "gemma4:e2b", "llava:7b"];
const DEFAULT_CLOUD_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";

app.post("/api/chat", async (req, res) => {
    try {
        const { message, messages, model, imageBase64 } = req.body;
        if (!message && !imageBase64) {
            return res.json({ response: "กรุณาพิมพ์ข้อความก่อนนะครับ" });
        }

        const useModel = model && model !== "auto" ? model : DEFAULT_CLOUD_MODEL;
        const isLocal = LOCAL_MODELS.includes(useModel);

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
            parts.push({ type: "image_url", image_url: { url: imageBase64.startsWith("data:") ? imageBase64 : "data:image/jpeg;base64," + imageBase64 } });
            msgs.push({ role: "user", content: parts });
        } else {
            msgs.push({ role: "user", content: message || "สวัสดี" });
        }

        let apiUrl, apiKey, apiModel;

        if (isLocal) {
            // Local Ollama — only works when running on local machine
            apiUrl = (process.env.OLLAMA_URL || "http://127.0.0.1:11434") + "/api/chat";
            apiModel = useModel;
        } else {
            // Cloud via OpenRouter (free models)
            apiUrl = "https://openrouter.ai/api/v1/chat/completions";
            apiKey = process.env.OPENROUTER_API_KEY;
            apiModel = useModel;
        }

        if (!isLocal && !apiKey) {
            return res.json({
                response: "⚠️ ต้องตั้งค่า OPENROUTER_API_KEY บน Render\n\nไปที่ Render → sebastian-tui → Environment → เพิ่ม Key\n\nหรือเลือกโมดล Local (Llama/Gemma) แทน",
                model: "fallback"
            });
        }

        const headers = { "Content-Type": "application/json" };
        if (apiKey) {
            headers["Authorization"] = "Bearer " + apiKey;
            headers["HTTP-Referer"] = "https://sebastian-tui.onrender.com";
            headers["X-Title"] = "Sebastian AI";
        }

        const body = isLocal
            ? JSON.stringify({ model: apiModel, messages: msgs, stream: false })
            : JSON.stringify({ model: apiModel, messages: msgs });

        const resp = await fetch(apiUrl, {
            method: "POST",
            headers,
            body,
            signal: AbortSignal.timeout(isLocal ? 120000 : 60000),
        });

        if (!resp.ok) {
            const errText = await resp.text();
            return res.json({ response: "⚠️ Error: " + resp.status + " " + errText.substring(0, 200) });
        }

        const data = await resp.json();
        const reply = isLocal
            ? (data.message?.content || "ไม่ได้รับคำตอบ")
            : (data.choices?.[0]?.message?.content || "ไม่ได้รับคำตอบ");

        res.json({ response: reply, model: apiModel });
    } catch (err) {
        console.error("chat error:", err);
        res.json({ response: "⚠️ ข้อผิดพลาด: " + err.message });
    }
});

app.listen(PORT, () => console.log("Sebastian TUI v2.3 on port " + PORT));