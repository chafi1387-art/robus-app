# Vérifie que l'envoi d'email fonctionne (sans rien envoyer) + la nouvelle table
cd /var/www/robus-app
node -e "require('dotenv').config();const n=require('nodemailer');const t=n.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT)||587,secure:Number(process.env.SMTP_PORT)===465,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD}});t.verify().then(()=>console.log('SMTP OK')).catch(e=>console.log('SMTP ERREUR',e.message))"
U=$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
psql "$U" -tAc "select count(*) from reinitialisations_mot_de_passe" 2>&1
for p in /connexion /mot-de-passe-oublie /reinitialiser; do echo "$p $(curl -s -o /dev/null -w '%{http_code}' https://robuswork.tech$p)"; done
