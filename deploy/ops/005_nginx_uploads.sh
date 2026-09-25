# Correctif : servir /uploads/ directement par nginx (fichiers ajoutes apres le build = 404 via Next.js)
set -u
U=/var/www/robus-app/public/uploads
F=$(readlink -f $(grep -l "server_name robuswork.tech" /etc/nginx/sites-enabled/* | head -1))
echo "--- contenu uploads"; ls -la $U; find $U -type f | wc -l
T=$(find $U -type f -printf '%T@ %P\n' | sort -rn | head -1 | cut -d' ' -f2-)
echo "Fichier test (le plus recent): $T"
echo "--- AVANT"; curl -s -o /dev/null -w "%{http_code}\n" "https://robuswork.tech/uploads/$T"
echo "photo du 22/09 presente sur disque ?"; ls -la $U/rapports/28dda13b-1fa9-452c-8e23-8ef5f99ce64e-1788518929509-188676.jpg 2>&1
cp -a $F /root/robus-deploy/nginx-robuswork.bak-$(date +%Y%m%d%H%M%S); cp -a $F /tmp/nginx-before
if ! grep -q "location ^~ /uploads/" $F; then
python3 - "$F" <<'P'
import sys; p=sys.argv[1]; s=open(p).read()
blk="""    location ^~ /uploads/ {
        alias /var/www/robus-app/public/uploads/;
        add_header X-Content-Type-Options nosniff;
        expires 7d;
        try_files $uri =404;
    }
"""
i=s.index("    location / {"); s=s[:i]+blk+s[i:]; open(p,"w").write(s)
P
fi
diff /tmp/nginx-before $F
chmod o+x /var/www /var/www/robus-app /var/www/robus-app/public 2>/dev/null; chmod -R o+rX $U
if nginx -t 2>&1 && systemctl reload nginx; then
  sleep 1
  echo "--- APRES"
  C=$(curl -s -o /dev/null -w "%{http_code}" "https://robuswork.tech/uploads/$T"); echo "fichier recent: $C"
  curl -s -o /dev/null -w "photo 22/09: %{http_code}\n" https://robuswork.tech/uploads/rapports/28dda13b-1fa9-452c-8e23-8ef5f99ce64e-1788518929509-188676.jpg
  curl -s -o /dev/null -w "inexistant: %{http_code}\n" https://robuswork.tech/uploads/nexistepas.jpg
  curl -s -o /dev/null -w "app /connexion: %{http_code}\n" https://robuswork.tech/connexion
  curl -6 -s -o /dev/null -w "IPv6 /connexion: %{http_code}\n" https://robuswork.tech/connexion
  if [ -n "$T" ] && [ "$C" != 200 ]; then echo "ECHEC test -> restauration"; cp -a /tmp/nginx-before $F; nginx -t && systemctl reload nginx; fi
else
  echo "nginx -t ECHEC -> restauration"; cp -a /tmp/nginx-before $F; nginx -t && systemctl reload nginx
fi
