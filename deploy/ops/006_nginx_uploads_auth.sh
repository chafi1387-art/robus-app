# Remet le controle d'acces sur /uploads/ : nginx demande a l'app (/api/auth-check) si l'utilisateur est connecte
set -u
cd /var/www/robus-app
H='-H Host:robuswork.tech -H X-Forwarded-Proto:https'
F=$(readlink -f $(grep -l "server_name robuswork.tech" /etc/nginx/sites-enabled/* | head -1))
C0=$(curl -s -o /dev/null -w "%{http_code}" $H http://localhost:3000/api/auth-check); echo "auth-check sans session: $C0"
[ "$C0" = 401 ] || { echo "ARRET: endpoint pas pret (attendu 401)"; exit 1; }
nginx -V 2>&1 | grep -o http_auth_request_module || { echo "ARRET: module auth_request absent"; exit 1; }
# Jeton de session de test (administrateur) pour verifier le cas connecte
SECRET=$(grep -E '^AUTH_SECRET=' .env | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
UID_ADM=$(sudo -u postgres psql -d robus_dashboard -tAc "select id from users where role='administrateur' and actif=1 limit 1")
TOK=$(AUTH_SECRET="$SECRET" UIDA="$UID_ADM" node --input-type=module -e "
import { encode } from '@auth/core/jwt';
const n='__Secure-authjs.session-token';
console.log(await encode({ token:{ sub:process.env.UIDA, id:process.env.UIDA, role:'administrateur' }, secret:process.env.AUTH_SECRET, salt:n, maxAge:600 }));")
CK="Cookie: __Secure-authjs.session-token=$TOK"
C1=$(curl -s -o /dev/null -w "%{http_code}" $H -H "$CK" http://localhost:3000/api/auth-check); echo "auth-check avec session: $C1"
[ "$C1" = 204 ] || { echo "ARRET: session non reconnue (attendu 204)"; exit 1; }
cp -a $F /root/robus-deploy/nginx-robuswork.bak-$(date +%Y%m%d%H%M%S); cp -a $F /tmp/nginx-before
python3 - "$F" <<'P'
import sys; p=sys.argv[1]; s=open(p).read()
if "auth_request /_robus_auth" not in s:
    s=s.replace("""    location ^~ /uploads/ {
        alias""","""    location = /_robus_auth {
        internal;
        proxy_pass http://localhost:3000/api/auth-check;
        proxy_pass_request_body off;
        proxy_set_header Content-Length "";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Cookie $http_cookie;
    }
    location @robus_login {
        return 302 /connexion;
    }
    location ^~ /uploads/ {
        auth_request /_robus_auth;
        error_page 401 = @robus_login;
        add_header Cache-Control "private";
        alias""",1)
    s=s.replace("        expires 7d;\n","",1)
    open(p,"w").write(s)
P
diff /tmp/nginx-before $F
T=rapports/28dda13b-1fa9-452c-8e23-8ef5f99ce64e-1788518929509-188676.jpg
ok=0
if nginx -t 2>&1 && systemctl reload nginx; then
  sleep 1
  A=$(curl -s -o /dev/null -w "%{http_code} %{redirect_url}" https://robuswork.tech/uploads/$T); echo "photo SANS connexion: $A"
  B=$(curl -s -o /dev/null -w "%{http_code}" -H "$CK" https://robuswork.tech/uploads/$T); echo "photo AVEC connexion: $B"
  B6=$(curl -6 -s -o /dev/null -w "%{http_code}" -H "$CK" https://robuswork.tech/uploads/$T); echo "photo AVEC connexion (IPv6): $B6"
  N=$(curl -s -o /dev/null -w "%{http_code}" -H "$CK" https://robuswork.tech/uploads/nexistepas.jpg); echo "inexistant connecte: $N"
  L=$(curl -s -o /dev/null -w "%{http_code}" https://robuswork.tech/connexion); echo "page connexion: $L"
  case "$A" in 302*connexion*) [ "$B" = 200 ] && [ "$L" = 200 ] && ok=1;; esac
fi
if [ $ok = 1 ]; then echo "RESULTAT: OK"; else echo "RESULTAT: ECHEC -> restauration"; cp -a /tmp/nginx-before $F; nginx -t && systemctl reload nginx; fi
