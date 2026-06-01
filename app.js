/* Sebastian TUI - app.js */
(function () {
    "use strict";

    // ===== STATE =====
    const state = {
        currentChatId: null,
        chats: {}, // { chatId: { id, title, messages[], createdAt, updatedAt } }
        model: "auto",
        isStreaming: false,
        sidebarOpen: true,
        currentTool: "chat",
        attachedFiles: [],
    };

    // ===== DOM REFS =====
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const sidebar = $("#sidebar");
    const messagesEl = $("#messages");
    const inputEl = $("#message-input");
    const sendBtn = $("#send-btn");
    const attachBtn = $("#attach-btn");
    const fileInput = $("#file-input");
    const voiceBtn = $("#voice-btn");
    const voiceModal = $("#voice-modal");
    const stopVoiceBtn = $("#stop-voice-btn");
    const imageModal = $("#image-modal");
    const generateImageBtn = $("#generate-image-btn");
    const imageResult = $("#image-result");
    const imagePrompt = $("#image-prompt");
    const modelSelect = $("#model-select");
    const chatHistoryList = $("#chat-history-list");
    const currentChatTitle = $("#current-chat-title");
    const currentModelBadge = $("#current-model-badge");
    const tokenCount = $("#token-count");
    const inputAttachments = $("#input-attachments");
    const statusText = $("#status-text");
    const statusDot = $(".status-dot");

    // ===== INITIALIZATION =====
    function init() {
        loadChats();
        setupEventListeners();
        renderChatHistory();
        createNewChat();
        checkBackendStatus();
        // Auto-resize textarea
        inputEl.addEventListener("input", autoResize);
    }

    // ===== EVENT LISTENERS =====
    function setupEventListeners() {
        // Send message
        sendBtn.addEventListener("click", sendMessage);
        inputEl.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        // Sidebar toggle
        $("#sidebar-toggle").addEventListener("click", () => {
            state.sidebarOpen = !state.sidebarOpen;
            sidebar.classList.toggle("collapsed", !state.sidebarOpen);
        });

        // New chat
        $("#new-chat-btn").addEventListener("click", () => createNewChat());

        // Clear chat
        $("#clear-chat-btn").addEventListener("click", () => {
            if (confirm("ล้างข้อความทั้งหมดในแชทนี้?")) {
                clearCurrentChat();
            }
        });

        // Export chat
        $("#export-chat-btn").addEventListener("click", exportChat);

        // Attach files
        attachBtn.addEventListener("click", () => fileInput.click());
        fileInput.addEventListener("change", handleFileAttach);

        // Voice
        voiceBtn.addEventListener("click", toggleVoiceRecording);
        stopVoiceBtn.addEventListener("click", stopVoiceRecording);

        // Image generation
        $$(".tool-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                const tool = btn.dataset.tool;
                if (tool === "image") {
                    imageModal.classList.remove("hidden");
                } else if (tool === "chat") {
                    // Already in chat view
                } else if (tool === "kanban") {
                    window.open("../dashboard/index.html", "_blank");
                }
                $$(".tool-btn").forEach((b) => b.classList.remove("active"));
                btn.classList.add("active");
            });
        });

        // Close modals
        $$(".close-modal").forEach((btn) => {
            btn.addEventListener("click", () => {
                imageModal.classList.add("hidden");
            });
        });

        // Generate image
        generateImageBtn.addEventListener("click", generateImage);

        // Model select
        modelSelect.addEventListener("change", (e) => {
            state.model = e.target.value;
            currentModelBadge.textContent =
                e.target.options[e.target.selectedIndex].text.split(" ")[0];
        });

        // Quick actions
        $$(".quick-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                inputEl.value = btn.dataset.prompt;
                inputEl.focus();
                autoResize.call(inputEl);
            });
        });

        // Click outside modal to close
        [imageModal, voiceModal].forEach((modal) => {
            modal.addEventListener("click", (e) => {
                if (e.target === modal) modal.classList.add("hidden");
            });
        });
    }

    // ===== CHAT MANAGEMENT =====
    function createNewChat() {
        const id = "chat_" + Date.now();
        state.chats[id] = {
            id,
            title: "แชทใหม่",
            messages: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        state.currentChatId = id;
        saveChats();
        renderChatHistory();
        renderMessages();
        currentChatTitle.textContent = "แชทใหม่";
    }

    function clearCurrentChat() {
        if (!state.currentChatId) return;
        state.chats[state.currentChatId].messages = [];
        saveChats();
        renderMessages();
    }

    function exportChat() {
        const chat = state.chats[state.currentChatId];
        if (!chat) return;
        let text = `# ${chat.title}\n`;
        text += `# ${new Date(chat.createdAt).toLocaleString("th-TH")}\n\n`;
        chat.messages.forEach((m) => {
            text += `## ${m.role === "user" ? "คุณ" : "Sebastian"}\n`;
            text += `${m.content}\n\n`;
        });
        const blob = new Blob([text], { type: "text/markdown" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${chat.title.replace(/[^a-zA-Z0-9ก-๙]/g, "_")}.md`;
        a.click();
        URL.revokeObjectURL(url);
    }

    // ===== SEND MESSAGE =====
    async function sendMessage() {
        const text = inputEl.value.trim();
        if (!text && state.attachedFiles.length === 0) return;
        if (state.isStreaming) return;

        // Hide welcome screen
        const welcome = $("#welcome-screen");
        if (welcome) welcome.style.display = "none";

        // Build content for display
        let displayContent = text;
        if (state.attachedFiles.length > 0) {
            const fileNames = state.attachedFiles.map((f) => f.name).join(", ");
            displayContent += `\n\n[แนบไฟล์: ${fileNames}]`;
        }

        // Add user message
        addMessage("user", displayContent);
        inputEl.value = "";
        inputEl.style.height = "auto";

        // Convert images to base64
        const imageBase64List = [];
        for (const file of state.attachedFiles) {
            if (file.type.startsWith("image/")) {
                const base64 = await fileToBase64(file);
                imageBase64List.push(base64);
            }
        }
        clearAttachments();

        // Update chat title if first message
        const chat = state.chats[state.currentChatId];
        if (chat.messages.length === 1 && text.length > 0) {
            chat.title = text.substring(0, 40) + (text.length > 40 ? "..." : "");
            currentChatTitle.textContent = chat.title;
            saveChats();
            renderChatHistory();
        }

        // Show typing indicator
        showTypingIndicator();

        // Call backend
        try {
            await callAgentAPI(text || "ภาพนี้เป็นไง", imageBase64List.length > 0 ? imageBase64List[0] : null);
        } catch (err) {
            removeTypingIndicator();
            addMessage("assistant", `⚠️ เกิดข้อผิดพลาด: ${err.message}`);
        }
    }

    function fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    function addMessage(role, content) {
        const chat = state.chats[state.currentChatId];
        if (!chat) return;

        const msg = {
            role,
            content,
            timestamp: new Date().toISOString(),
        };
        chat.messages.push(msg);
        chat.updatedAt = new Date().toISOString();
        saveChats();
        renderMessages();
    }

    // ===== API CALL =====
    async function callAgentAPI(userMessage, imagePaths) {
        state.isStreaming = true;
        sendBtn.disabled = true;

        // Build context from recent messages
        const chat = state.chats[state.currentChatId];
        const recentMessages = chat.messages.slice(-10);

        // Determine model
        let model = state.model;
        if (!model || model === "auto") {
            model = "nvidia/nemotron-3-super-120b-a12b:free";
        }

        try {
            // Try to call Hermes backend
            const response = await fetch("http://127.0.0.1:8888/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    message: userMessage,
                    messages: recentMessages,
                    model: model,
                    imageBase64: imagePaths,
                }),
                signal: AbortSignal.timeout(120000),
            });

            removeTypingIndicator();

            if (!response.ok) {
                throw new Error(`Backend error: ${response.status}`);
            }

            const data = await response.json();
            if (data.error) {
                addMessage("assistant", `⚠️ ${data.error}\n\n${data.response || ""}`);
            } else {
                addMessage("assistant", data.response || "ไม่ได้รับคำตอบ");
            }
        } catch (err) {
            // Fallback: simulate response for demo
            removeTypingIndicator();
            if (err.name === "TimeoutError" || err.name === "AbortError") {
                addMessage("assistant", "⏱️ การตอบใช้เวลานานเกินไป กรุณาลองใหม่อีกครั้ง");
            } else if (err.message.includes("Failed to fetch") || err.message.includes("ECONNREFUSED")) {
                // Backend not running - use demo mode
                await simulateResponse(userMessage);
            } else {
                addMessage("assistant", `⚠️ เกิดข้อผิดพลาด: ${err.message}`);
            }
        } finally {
            state.isStreaming = false;
            sendBtn.disabled = false;
        }
    }

    // Simulated response for demo (remove when backend is ready)
    async function simulateResponse(userMessage) {
        const responses = {
            สวัสดี: "สวัสดีครับ Diamond! ผม Sebastian พร้อมช่วยเหลือคุณเสมอ วันนี้ต้องการให้ผมช่วยอะไรครับ?",
            งาน: "นี่คืองานที่ค้างอยู่:\n\n1. 📹 ทำวิดีโอ YouTube EP.1 (สำคัญมาก)\n2. 🎨 สร้างรูป Aries สำหรับ Etsy\n3. 📋 ตรวจสอบอุปกรณ์คลินิก\n\nต้องการดูรายละเอียดเพิ่มเติมไหมครับ?",
            รูป: "คุณสามารถเปิดเมนูสร้างรูปได้ที่ปุ่ม 🎨 ด้านซ้าย หรือพิมพ์ /image ตามด้วยคำอธิบายรูปที่ต้องการครับ",
            เสียง: "คุณสามารถกดปุ่ม 🎤 เพื่อสั่งงานด้วยเสียงได้เลยครับ ระบบจะแปลงเสียงเป็นข้อความโดยอัตโนมัติ",
        };

        let response = "ขอบคุณสำหรับข้อความครับ ผมกำลังประมวลผล...\n\n";
        response += "💡 **เคล็ดลับ:**\n";
        response += "- กด 📎 เพื่อแนบไฟล์หรือรูป\n";
        response += "- กด 🎤 เพื่อสั่งงานด้วยเสียง\n";
        response += "- กด 🎨 เพื่อสร้างรูป\n";
        response += "- กด 📋 เพื่อดูกระดานงาน\n";
        response += "- พิมพ์ `/big` เพื่อใช้โมเดลขนาดใหญ่";

        // Check for keywords
        for (const [key, val] of Object.entries(responses)) {
            if (userMessage.includes(key)) {
                response = val;
                break;
            }
        }

        // Simulate typing delay
        await new Promise((r) => setTimeout(r, 800));
        addMessage("assistant", response);
    }

    // ===== RENDERING =====
    function renderMessages() {
        const chat = state.chats[state.currentChatId];
        if (!chat) return;

        // Keep welcome screen if no messages
        if (chat.messages.length === 0) {
            messagesEl.innerHTML = `
                <div class="welcome-screen" id="welcome-screen">
                    <div class="welcome-logo">◆</div>
                    <h1>สวัสดี, Diamond</h1>
                    <p>ผม Sebastian — ผู้ช่วย AI ของคุณ</p>
                    <div class="quick-actions">
                        <button class="quick-btn" data-prompt="ช่วยวางแผนคอนเทนต์ YouTube สัปดาห์นี้">📹 วางแผน YouTube</button>
                        <button class="quick-btn" data-prompt="สร้างรูป Aries character สำหรับ Etsy">🎨 สร้างรูป Aries</button>
                        <button class="quick-btn" data-prompt="ดูงานที่ค้างอยู่ในตาราง">📋 ดูงานค้าง</button>
                        <button class="quick-btn" data-prompt="สรุปอีเมลและตารางงานวันนี้">📧 สรุปเช้า</button>
                    </div>
                </div>`;
            // Re-attach quick-btn listeners
            $$(".quick-btn").forEach((btn) => {
                btn.addEventListener("click", () => {
                    inputEl.value = btn.dataset.prompt;
                    inputEl.focus();
                    autoResize.call(inputEl);
                });
            });
            return;
        }

        let html = "";
        chat.messages.forEach((msg, i) => {
            const isUser = msg.role === "user";
            const time = new Date(msg.timestamp).toLocaleTimeString("th-TH", {
                hour: "2-digit",
                minute: "2-digit",
            });
            const avatar = isUser ? "👤" : "◆";
            const name = isUser ? "คุณ" : "Sebastian";

            // Parse markdown for assistant messages
            let body = isUser
                ? escapeHtml(msg.content).replace(/\n/g, "<br>")
                : marked.parse(msg.content);

            html += `
                <div class="message ${msg.role}">
                    <div class="message-avatar">${avatar}</div>
                    <div class="message-content">
                        <div class="message-header">
                            <span class="message-name">${name}</span>
                            <span class="message-time">${time}</span>
                        </div>
                        <div class="message-body">${body}</div>
                        <div class="message-actions">
                            <button class="msg-action-btn" onclick="copyMessage(${i})">📋 คัดลอก</button>
                            ${!isUser ? `<button class="msg-action-btn" onclick="regenerate(${i})">🔄 สร้างใหม่</button>` : ""}
                        </div>
                    </div>
                </div>`;
        });

        messagesEl.innerHTML = html;
        messagesEl.scrollTop = messagesEl.scrollHeight;

        // Highlight code blocks
        $$("pre code").forEach((block) => {
            hljs.highlightElement(block);
        });
    }

    function renderChatHistory() {
        const chatIds = Object.keys(state.chats).sort(
            (a, b) => new Date(state.chats[b].updatedAt) - new Date(state.chats[a].updatedAt)
        );

        let html = "";
        chatIds.forEach((id) => {
            const chat = state.chats[id];
            const isActive = id === state.currentChatId;
            const date = new Date(chat.updatedAt).toLocaleDateString("th-TH", {
                day: "numeric",
                month: "short",
            });
            html += `
                <div class="history-item ${isActive ? "active" : ""}" data-id="${id}">
                    <span class="history-title">${escapeHtml(chat.title)}</span>
                    <span class="history-date">${date}</span>
                </div>`;
        });

        chatHistoryList.innerHTML = html;

        // Click to switch chat
        $$(".history-item").forEach((item) => {
            item.addEventListener("click", () => {
                state.currentChatId = item.dataset.id;
                currentChatTitle.textContent = state.chats[state.currentChatId].title;
                renderChatHistory();
                renderMessages();
            });
        });
    }

    function showTypingIndicator() {
        const html = `
            <div class="message assistant" id="typing-indicator">
                <div class="message-avatar">◆</div>
                <div class="message-content">
                    <div class="typing-indicator">
                        <span></span><span></span><span></span>
                    </div>
                </div>
            </div>`;
        messagesEl.insertAdjacentHTML("beforeend", html);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function removeTypingIndicator() {
        const el = $("#typing-indicator");
        if (el) el.remove();
    }

    // ===== FILE ATTACHMENTS =====
    function handleFileAttach(e) {
        const files = Array.from(e.target.files);
        files.forEach((file) => {
            state.attachedFiles.push(file);
        });
        renderAttachments();
        fileInput.value = "";
    }

    function renderAttachments() {
        let html = "";
        state.attachedFiles.forEach((file, i) => {
            const isImage = file.type.startsWith("image/");
            const preview = isImage
                ? `<img src="${URL.createObjectURL(file)}" alt="${file.name}">`
                : `<span>📄</span>`;
            html += `
                <div class="attachment-chip">
                    ${preview}
                    <span>${file.name}</span>
                    <span class="remove" onclick="removeAttachment(${i})">✕</span>
                </div>`;
        });
        inputAttachments.innerHTML = html;
    }

    window.removeAttachment = function (index) {
        state.attachedFiles.splice(index, 1);
        renderAttachments();
    };

    function clearAttachments() {
        state.attachedFiles = [];
        renderAttachments();
    }

    // ===== VOICE RECORDING =====
    let mediaRecorder = null;
    let audioChunks = [];

    function toggleVoiceRecording() {
        if (mediaRecorder && mediaRecorder.state === "recording") {
            stopVoiceRecording();
        } else {
            startVoiceRecording();
        }
    }

    async function startVoiceRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];

            mediaRecorder.ondataavailable = (e) => {
                audioChunks.push(e.data);
            };

            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
                // In production, send to speech-to-text API
                // For now, use Web Speech API
                transcribeAudio(audioBlob);
                stream.getTracks().forEach((t) => t.stop());
            };

            mediaRecorder.start();
            voiceModal.classList.remove("hidden");
        } catch (err) {
            alert("ไม่สามารถเข้าถึงไมโครโฟนได้: " + err.message);
        }
    }

    function stopVoiceRecording() {
        if (mediaRecorder && mediaRecorder.state === "recording") {
            mediaRecorder.stop();
        }
        voiceModal.classList.add("hidden");
    }

    function transcribeAudio(blob) {
        // Use Web Speech API for Thai transcription
        if ("webkitSpeechRecognition" in window || "SpeechRecognition" in window) {
            const SpeechRecognition =
                window.SpeechRecognition || window.webkitSpeechRecognition;
            const recognition = new SpeechRecognition();
            recognition.lang = "th-TH";
            recognition.onresult = (e) => {
                const text = e.results[0][0].transcript;
                inputEl.value = text;
                inputEl.focus();
                autoResize.call(inputEl);
            };
            recognition.onerror = () => {
                inputEl.value = "ไม่สามารถแปลงเสียงได้ กรุณาลองใหม่";
            };
            recognition.start();
        } else {
            inputEl.value = "เบราว์เซอร์ไม่รองรับการแปลงเสียง";
        }
    }

    // ===== IMAGE GENERATION =====
    async function generateImage() {
        const prompt = imagePrompt.value.trim();
        if (!prompt) return;

        generateImageBtn.disabled = true;
        generateImageBtn.textContent = "กำลังสร้าง...";
        imageResult.innerHTML = `<div class="image-placeholder">🎨 กำลังสร้างรูป...</div>`;

        try {
            // Call Leonardo AI or other image generation API
            const response = await fetch("http://127.0.0.1:8888/api/image", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    prompt: prompt,
                    style: $("#image-style").value,
                    size: $("#image-size").value,
                }),
            });

            if (!response.ok) throw new Error("Image generation failed");

            const data = response.json();
            imageResult.innerHTML = `<img src="${data.imageUrl}" alt="${prompt}">`;
        } catch (err) {
            // Fallback: show placeholder
            imageResult.innerHTML = `
                <div class="image-placeholder">
                    <p>🎨 ตัวอย่างรูปที่จะสร้าง</p>
                    <p><strong>Prompt:</strong> ${escapeHtml(prompt)}</p>
                    <p><strong>Style:</strong> ${$("#image-style").value}</p>
                    <p><strong>Size:</strong> ${$("#image-size").value}</p>
                    <p style="margin-top:12px;color:var(--text-muted)">
                        (ต้องเชื่อมต่อ Leonardo AI API ก่อนใช้งานจริง)
                    </p>
                </div>`;
        } finally {
            generateImageBtn.disabled = false;
            generateImageBtn.textContent = "สร้างรูป";
        }
    }

    // ===== BACKEND STATUS =====
    async function checkBackendStatus() {
        try {
            const resp = await fetch("http://127.0.0.1:8888/api/health", {
                method: "GET",
                signal: AbortSignal.timeout(3000),
            });
            if (resp.ok) {
                statusText.textContent = "เชื่อมต่อแล้ว";
                statusDot.className = "status-dot online";
            } else {
                throw new Error();
            }
        } catch {
            statusText.textContent = "โหมดสาธิต (Backend ไม่ทำงาน)";
            statusDot.className = "status-dot loading";
        }
    }

    // Check status periodically
    setInterval(checkBackendStatus, 30000);

    // ===== STORAGE =====
    function saveChats() {
        try {
            localStorage.setItem("sebastian_chats", JSON.stringify(state.chats));
        } catch (e) {
            console.error("Failed to save chats:", e);
        }
    }

    function loadChats() {
        try {
            const saved = localStorage.getItem("sebastian_chats");
            if (saved) {
                state.chats = JSON.parse(saved);
            }
        } catch (e) {
            console.error("Failed to load chats:", e);
        }
    }

    // ===== UTILITIES =====
    function autoResize() {
        this.style.height = "auto";
        this.style.height = Math.min(this.scrollHeight, 200) + "px";
    }

    function escapeHtml(text) {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }

    window.copyMessage = function (index) {
        const chat = state.chats[state.currentChatId];
        if (!chat || !chat.messages[index]) return;
        navigator.clipboard.writeText(chat.messages[index].content);
    };

    window.regenerate = async function (index) {
        const chat = state.chats[state.currentChatId];
        if (!chat || index < 1) return;
        // Remove messages from index onwards
        chat.messages = chat.messages.slice(0, index);
        renderMessages();
        // Re-send the last user message
        const lastUserMsg = chat.messages[chat.messages.length - 1];
        if (lastUserMsg && lastUserMsg.role === "user") {
            showTypingIndicator();
            try {
                await callAgentAPI(lastUserMsg.content);
            } catch (err) {
                removeTypingIndicator();
                addMessage("assistant", `⚠️ เกิดข้อผิดพลาด: ${err.message}`);
            }
        }
    };

    // ===== START =====
    init();
})();