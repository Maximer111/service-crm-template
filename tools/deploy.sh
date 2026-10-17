#!/bin/sh
# Единственный способ выкатить функцию CLB CRM.
#
# Зачем: за неделю 28.09-01.10 три сессии деплоили из трёх разных папок. Одна
# выкатила CRM в старую базу и затёрла пересыльщики (WhatsApp два дня писал мимо),
# другая выкатила дашборд и ответы об оплате без коммита, и код жил только на сервере.
# Скрипт не даёт повторить ни то, ни другое.
#
#   tools/deploy.sh crm-bot [crm-dashboard ...]
set -eu
REF=YOUR_PROJECT_REF
cd "$(git rev-parse --show-toplevel)"
[ $# -ge 1 ] || { echo "Использование: tools/deploy.sh <функция> [ещё функции]"; exit 2; }

if [ -n "$(git status --porcelain -- supabase)" ]; then
  echo "СТОП: в supabase/ есть незакоммиченные правки. Сначала коммит, потом деплой:"; git status --short -- supabase; exit 1
fi
git fetch -q origin
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  echo "СТОП: деплой только из main, совпадающего с origin/main."
  echo "  сейчас: $(git branch --show-current) $(git rev-parse --short HEAD), origin/main: $(git rev-parse --short origin/main)"
  echo "  сделай: git checkout main && git pull, свои правки вливай через ветку и push."
  exit 1
fi
printf '%s' "$REF" > supabase/.temp/project-ref 2>/dev/null || { mkdir -p supabase/.temp && printf '%s' "$REF" > supabase/.temp/project-ref; }

version() { supabase functions list --project-ref "$REF" -o json 2>/dev/null | python3 -c "
import json,sys
d=json.load(sys.stdin); d=d.get('functions',d) if isinstance(d,dict) else d
print(next((f['version'] for f in d if f['slug']=='$1'),0))"; }

for fn in "$@"; do
  [ -d "supabase/functions/$fn" ] || { echo "СТОП: нет функции $fn"; exit 1; }
  before=$(version "$fn")
  supabase functions deploy "$fn" --project-ref "$REF" --no-verify-jwt --use-api >/dev/null
  after=$(version "$fn")
  # CLI умеет написать «Deployed» и не выкатить ничего: верим только номеру версии.
  [ "$after" -gt "$before" ] || { echo "СТОП: $fn осталась на v$before, деплой не прошёл."; exit 1; }
  echo "$fn: v$before → v$after ($(git rev-parse --short HEAD))"
done
