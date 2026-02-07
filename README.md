# Test01

Prototype minimal d'une application de messagerie en temps réel (demo).

Démarrage (Node.js requis) :

```bash
npm install
npm start
```

Pages:
- /register.html — inscription
- /login.html — connexion
- /chat.html — interface de chat

Notes:
- Prototype très basique; changer la valeur `SECRET` dans `server/auth.js` avant production.
- DB: SQLite stockée dans `data/app.db`.

Pour développement : installez `nodemon` globalement ou utilisez `npm run dev`.

Configuration et vérification téléphone:
- Copiez `.env.example` en `.env` et remplissez `JWT_SECRET` (fort) et, si vous voulez envoyer des SMS, `TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM`.
- Sans Twilio configuré, les codes de vérification sont écrits dans la sortie serveur (utile pour dev).

Sécurité et production (notes rapides):
- Utiliser HTTPS (reverse proxy comme Nginx ou déployer derrière une plateforme proposant TLS).
- Ne jamais exposer `JWT_SECRET` ou clés Twilio en dépôt public.
- Pour la conformité et vie privée, stocker les numéros de téléphone chiffés au repos si nécessaire et respecter la législation locale.
- Ce prototype n'implémente pas de chiffrement de bout en bout (E2E). Pour E2E, considérer libs établies et audits.