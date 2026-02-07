async function postJSON(url, data){
  const res = await fetch(url, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  return res.json();
}

// register/login forms
const registerForm = document.getElementById('registerForm');
if (registerForm){
  registerForm.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fd = new FormData(registerForm);
    const data = { username: fd.get('username'), password: fd.get('password'), displayName: fd.get('displayName'), phone: fd.get('phone') };
    const res = await postJSON('/api/register', data);
    if (res.token){ localStorage.setItem('token', res.token); window.location = '/chat.html'; }
    else alert(res.error || 'Erreur');
  });
}

const loginForm = document.getElementById('loginForm');
if (loginForm){
  loginForm.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fd = new FormData(loginForm);
    const data = { username: fd.get('username'), password: fd.get('password') };
    const res = await postJSON('/api/login', data);
    if (res.token){ localStorage.setItem('token', res.token); window.location = '/chat.html'; }
    else alert(res.error || 'Erreur');
  });
}

// redirect to login if not authenticated on chat page
if (location.pathname.endsWith('/chat.html')){
  const token = localStorage.getItem('token');
  if (!token) location = '/login.html';
}
