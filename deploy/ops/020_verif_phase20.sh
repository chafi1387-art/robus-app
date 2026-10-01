# Vérification Phase 20 (lecture seule)
cd /var/www/robus-app
U=$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
echo "== commit"; git log --oneline -1
echo "== tables"; for t in documents_client documents_client_consultations demandes_client demandes_messages; do echo "$t $(psql "$U" -tAc "select count(*) from $t" 2>&1)"; done
echo "== documents internes encore « visibles » (doit être 0)"; psql "$U" -tAc "select count(*) from documents_formations where visible_observateur=1"
echo "== demandes"; psql "$U" -P pager=off -c "select numero, type, statut, origine, created_at from demandes_client order by created_at desc limit 5"
echo "== cron"; S=$(grep -E '^CRON_SECRET=' .env | cut -d= -f2- | tr -d '"'); curl -s -X POST -H "x-cron-secret: $S" http://localhost:3000/api/cron/retards; echo
echo "== pages"; for p in /responsable/demandes /observateur/demandes /connexion; do curl -s -o /dev/null -w "$p %{http_code}\n" http://localhost:3000$p; done
echo "== SMTP"; node -e "require('dotenv').config();const n=require('nodemailer');const t=n.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT)||587,secure:Number(process.env.SMTP_PORT)===465,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD}});t.verify().then(()=>console.log('SMTP OK')).catch(e=>console.log('SMTP ERREUR',e.message))" 2>/dev/null | grep SMTP
echo "== pm2"; pm2 jlist | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{for(const p of JSON.parse(d))console.log(p.name,p.pm2_env.status)})"
echo "== erreurs récentes"; tail -n 200 /root/.pm2/logs/robus-dashboard-error.log | grep -E "⨯|Error" | grep -vE "UnknownAction|UntrustedHost|Server Reference|Failed to find Server Action|existe déjà" | tail -10
date
