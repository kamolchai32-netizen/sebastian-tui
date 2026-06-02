/* Sebastian Control Center - control.js */
(function() {
    "use strict";

    const state = {
        currentPage: "chat",
        model: "auto",
        messages: [],
        skills: [
            { name: "snmri-orthotics", desc: "คลินิกออร์โธติกส์ SNMRI", enabled: true },
            { name: "leo-content-creator", desc: "สร้างคอนเทนต์ YouTube และ Etsy", enabled: true },
            { name: "family-silver-wellness", desc: "การเงินครอบครัวและโลจิสติกส์", enabled: false },
            { name: "thai-automation", desc: "เวิร์กโฟลว์ n8n + Google Sheets", enabled: true },
            { name: "aries-design", desc: "ออกแบบสร้างสรรค์สำหรับ Aries", enabled: true },
            { name: "youtube-production", desc: "การผลิตวิดีโอ YouTube", enabled: true },
            { name: "model-router", desc: "สลับโมเดลอัตโนมัติ", enabled: true }
        ],
        tasks: { todo: [], inprogress: [], done: [] },
        modelRules: [
            { match: "code,สร้าง,เขียน,script", model: "auto" },
            { match: "รูป,image,สร้างรูป", model: "llava:7b" },
            { match: "วิเคราะห์,คำนวณ,เหตุผล", model: "nvidia/nemotron-3-super-120b-a12b:free" }
        ]
    };

    const $ = s => document.querySelector(s);
    const $$ = s => document.querySelectorAll(s);

    function init() {
        setupNav();
        setupChat();
        loadSettings();
        renderSkills();
        renderModels();
    }

    /* Navigation */
    function setupNav() {
        $$(".nav-item").forEach(btn => {
            btn.addEventListener("click", () => {
                state.currentPage = btn.dataset.page;
                $$(".nav-item").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                $$(".page").forEach(p => p.classList.remove("active"));
                $("#page-" + state.currentPage).classList.add("active");
            });
        });
    }

    /* Chat */
    function setupChat() {
        const input = $("#chat-input");
        input.addEventListener("keydown", e => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
        });
        input.addEventListener("input", () => {
            input.style.height = "auto";
            input.style.height = Math.min(input.scrollHeight, 150) + "px";
        });
        $("#send-btn").addEventListener("click", sendMessage);
        $("#chat-model-select").addEventListener("change", e => state.model = e.target.value);
        $$(".quick-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                input.value = btn.dataset.prompt;
                input.focus();
            });
        });
    }

    async function sendMessage() {
        const input = $("#chat-input");
        const text = input.value.trim();
        if (!text) return;

        addMessage("user", text);
        input.value = "";
        input.style.height = "auto";

        showTyping();

        try {
            const model = state.model === "auto" ? pickModel(text) : state.model;
            const resp = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: text, messages: state.messages, model })
            });
            const data = await resp.json();
            removeTyping();
            addMessage("assistant", data.response || "ไม่ได้รับคำตอบ");
        } catch (err) {
            removeTyping();
            addMessage("assistant", "⚠️ " + err.message);
        }
    }

    function pickModel(text) {
        const lower = text.toLowerCase();
        for (const rule of state.modelRules) {
            const keywords = rule.match.split(",");
            if (keywords.some(k => lower.includes(k.trim()))) return rule.model;
        }
        return "nvidia/nemotron-3-super-120b-a12b:free";
    }

    function addMessage(role, content) {
        state.messages.push({ role, content, ts: Date.now() });
        const div = document.createElement("div");
        div.className = "message " + role;
        const avatar = role === "user" ? "👤" : "◆";
        div.innerHTML = `<div class="message-avatar">${avatar}</div><div class="message-body">${marked.parse(content)}</div>`;
        const msgs = $("#chat-messages");
        const welcome = msgs.querySelector(".welcome");
        if (welcome) welcome.style.display = "none";
        msgs.appendChild(div);
        msgs.scrollTop = msgs.scrollHeight;
    }

    function showTyping() {
        const div = document.createElement("div");
        div.className = "message assistant";
        div.id = "typing";
        div.innerHTML = `<div class="message-avatar">◆</div><div class="message-body"><div class="typing"><span></span><span></span><span></span></div></div>`;
        $("#chat-messages").appendChild(div);
    }

    function removeTyping() {
        const el = $("#typing");
        if (el) el.remove();
    }

    /* Skills */
    function renderSkills() {
        const grid = $("#skills-grid");
        grid.innerHTML = state.skills.map((s, i) => `
            <div class="skill-card">
                <h4>${s.name}</h4>
                <p>${s.desc}</p>
                <div class="skill-toggle">
                    <input type="checkbox" ${s.enabled ? "checked" : ""} data-idx="${i}">
                    <span>${s.enabled ? "เปิด" : "ปิด"}</span>
                </div>
            </div>
        `).join("");
        $$(".skill-toggle input").forEach(cb => {
            cb.addEventListener("change", () => {
                state.skills[cb.dataset.idx].enabled = cb.checked;
                cb.nextElementSibling.textContent = cb.checked ? "เปิด" : "ปิด";
            });
        });
    }

    /* Models */
    function renderModels() {
        const cloud = [
            { name: "Nemotron Super 120B", id: "nvidia/nemotron-3-super-120b-a12b:free", ctx: "1M" },
            { name: "Kimi K2.6", id: "moonshotai/kimi-k2.6:free", ctx: "256K" },
            { name: "Gemma 4 26B", id: "google/gemma-4-26b-a4b-it:free", ctx: "256K" }
        ];
        const local = [
            { name: "Llama 3.2 3B", id: "llama3.2:3b" },
            { name: "Gemma 4 E2B", id: "gemma4:e2b" },
            { name: "Llava 7B (Vision)", id: "llava:7b" }
        ];

        $("#cloud-models").innerHTML = cloud.map(m => `
            <div class="model-item">
                <div><div class="name">${m.name}</div><div style="font-size:0.75rem;color:var(--muted)">${m.id} • ${m.ctx || ""}</div></div>
                <span class="status online">ฟรี</span>
            </div>
        `).join("");

        $("#local-models").innerHTML = local.map(m => `
            <div class="model-item">
                <div><div class="name">${m.name}</div><div style="font-size:0.75rem;color:var(--muted)">${m.id}</div></div>
                <span class="status online">Local</span>
            </div>
        `).join("");

        $("#model-rules").innerHTML = state.modelRules.map((r, i) => `
            <div class="model-item">
                <div><div class="name">ถาม: ${r.match}</div><div style="font-size:0.75rem;color:var(--muted)">→ ${r.model}</div></div>
                <button class="btn small" onclick="removeRule(${i})">ลบ</button>
            </div>
        `).join("");
    }

    window.removeRule = function(i) {
        state.modelRules.splice(i, 1);
        renderModels();
    };

    /* Settings */
    function loadSettings() {
        const key = localStorage.getItem("openrouter_key") || "";
        $("#setting-openrouter-key").value = key;
        $("#save-settings-btn").addEventListener("click", () => {
            localStorage.setItem("openrouter_key", $("#setting-openrouter-key").value);
            localStorage.setItem("telegram_token", $("#setting-telegram-token").value);
            alert("บันทึกแล้ว!");
        });
        $("#setup-telegram-btn").addEventListener("click", async () => {
            const resp = await fetch("/telegram/setup");
            const data = await resp.json();
            alert(data.ok ? "Telegram webhook ตั้งค่าแล้ว!" : "ผิดพลาด: " + JSON.stringify(data));
        });
    }

    init();
})();