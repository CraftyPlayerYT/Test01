(async ()=>{
  const token = localStorage.getItem('token');
  if (!token) { location = '/login.html'; return; }

  async function api(path){
    const r = await fetch(path, { headers: { Authorization: 'Bearer '+token } });
    return r.json();
  }

  const meRes = await api('/api/me');
  const myId = meRes.user.id;

  // load contacts
  const contactsRes = await api('/api/contacts');
  const contacts = contactsRes.contacts || [];
  const contactsList = document.getElementById('contactsList');
  let currentChat = null;

  contacts.forEach(c=>{
    const li = document.createElement('li');
    li.textContent = c.displayName || c.username;
    li.dataset.id = c.id;
    li.style.cursor = 'pointer';
    li.addEventListener('click', ()=> selectContact(c));
    contactsList.appendChild(li);
  });

  const messagesEl = document.getElementById('messages');
  const chatHeader = document.getElementById('chatHeader');
  const input = document.getElementById('msgInput');
  const sendBtn = document.getElementById('sendBtn');

  function renderMessages(msgs){
    messagesEl.innerHTML = '';
    msgs.forEach(m => {
      const d = document.createElement('div');
      d.textContent = (m.from_id === myId ? 'Moi: ' : '') + m.content;
      messagesEl.appendChild(d);
    });
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  async function selectContact(c){
    currentChat = c;
    chatHeader.textContent = 'Chat avec ' + (c.displayName || c.username);
    const res = await api('/api/messages/' + c.id);
    renderMessages(res.messages || []);
  }

  // socket
  const socket = io({ auth: { token } });
  socket.on('connect_error', (err)=>{ console.error('Socket error', err); });
  socket.on('private_message', (msg)=>{
    // if message belongs to current chat, append
    if (!currentChat) return;
    if (msg.from_id === currentChat.id || msg.to_id === currentChat.id) {
      const d = document.createElement('div');
      d.textContent = (msg.from_id === myId ? 'Moi: ' : '') + msg.content;
      messagesEl.appendChild(d);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  });

  sendBtn.addEventListener('click', ()=>{
    const text = input.value.trim();
    if (!text || !currentChat) return;
    socket.emit('private_message', { to: currentChat.id, content: text });
    input.value = '';
  });
})();
