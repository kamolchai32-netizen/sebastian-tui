const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8888;

app.use(cors());
app.use(express.json({ limit: "50mb" }));

// Serve TUI frontend from same directory
app.use("/tui", express.static(__dirname));
app.get("/tui", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/", (req, res) => res.redirect("/tui"));

// Health
app.get("/api/health", (req, res) => res.json({ status: "ok", ts: Date.now() }));

// Chat - uses OpenRouter API (works on Render)
app.post("/api/chat", function(req, res) {
    const message = req.body.message || "";
    const messages = req.body.messages || [];
    const model = req.body.model && req.body.model !== "auto" ? req.body.model : "mistralai/mistral-nemo";
    const imageBase64 = req.body.imageBase64 || null;
    const apiKey = process.env.OPENROUTER_API_KEY;

    console.log("chat:", { message: message.substring(0,30), model, hasImage: !!imageBase64, hasKey: !!apiKey });

    if (!message && !imageBase64) {
        return res.json({ response: "กรุณาพิมพ์ข้อความก่อนนะครับ" });
    }

    if (!apiKey) {
        return res.json({
            response: "⚠️ ยังไม่ได้ตั้งค่า OPENROUTER_API_KEY\n\nไปที่ Render → sebastian-tui → Environment → เพิ่ม Key"
        });
    }

    const msgs = [
        { role: "system", content: "คุณคือ Sebastian ผู้ช่วย AI ส่วนตัวของ Diamond ตอบเป็นภาษาไทย สุภาพ เป็นกันเอง" }
    ];

    if (messages && messages.length > 0) {
        messages.slice(-8).forEach(function(m) {
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

    const useModel = imageBase64 ? "meta-llama/llama-3.2-11b-vision-instruct:free" : model;

    fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": "Bearer " + apiKey,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://sebastian-tui.onrender.com",
            "X-Title": "Sebastian AI"
        },
        body: JSON.stringify({ model: useModel, messages: msgs }),
        signal: AbortSignal.timeout(60000),
    })
    .then(function(resp) {
        if (!resp.ok) return resp.text().then(function(t) { throw new Error("OpenRouter " + resp.status + ": " + t.substring(0,200)); });
        return resp.json();
    })
    .then(function(data) {
        const reply = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) ? data.choices[0].message.content : JSON.stringify(data).substring(0,300);
        console.log("reply:", reply.substring(0,50));
        res.json({ response: reply, model: useModel });
    })
    .catch(function(err) {
        console.error("chat err:", err.message);
        res.json({ response: "⚠️ " + err.message });
    });
});

app.listen(PORT, function() {
    console.log("Sebastian TUI v2 on port " + PORT);
    console.log("OPENROUTER_API_KEY:", process.env.OPENROUTER_API_KEY ? "SET" : "MISSING");
});