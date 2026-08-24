#!/usr/bin/env bash
# Create a locked-down, forwarding-only SSH user for WeighCore terminals.
# The key may ONLY forward to the SQL port; no shell, no other access.
set -e
PUB='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGdErhRC9HPy72gKW/j1v9cDw0/cF6IIxjffCdh70jRm wctunnel@weighcore'
id wctunnel >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin -m -d /home/wctunnel wctunnel
install -d -m 700 -o wctunnel -g wctunnel /home/wctunnel/.ssh
AK=/home/wctunnel/.ssh/authorized_keys
printf '%s\n' "no-pty,no-agent-forwarding,no-X11-forwarding,permitopen=\"127.0.0.1:1433\" ${PUB}" > "$AK"
chown wctunnel:wctunnel "$AK"
chmod 600 "$AK"
# make sure sshd is not restricting logins to specific users only
if grep -qiE '^\s*AllowUsers' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null; then
  echo "NOTE: sshd has AllowUsers set — wctunnel may need to be added there."
fi
echo "wctunnel ready:"
cat "$AK"
