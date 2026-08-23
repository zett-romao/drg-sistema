# BACKLOG — DRG-Kronos

> Estado vivo do produto. Criado em 22/08/2026 para não perder a pendência abaixo.

## 📧 E-mail: conta PRÓPRIA + Brevo de reserva — ⬜ pendente (anotado em 22/08/2026)

**Decisão do dono (22/08/2026):** acabou a conta Resend única da casa. Cada app
ganha **conta própria no Resend** e mais uma **no Brevo**, como reserva.

**Por quê:** os 100/dia do Resend eram da CONTA, divididos por nove apps. Em
20/08 estourou (200% num dia) — e o `429` cala senha, pânico, cobrança e aviso
de **TODOS**, não só de quem gastou. Conta própria acaba com isso; o Brevo é a
margem em cima: **100/dia (Resend) + 300/dia (Brevo) ≈ 400/dia só do DRG-Kronos**.

ℹ️ Quem manda e-mail aqui é o `drg-monitor-worker.js`.

**O molde já está pronto e testado no Sind.ia** (`C:ProjetosDRG-Sindico`,
commit `f75e38d`): `backend/src/services/email.js` com os dois motores por API e
queda automática, mais a bancada `npm run teste:email` (21 casos, `fetch`
dublado, nenhuma rede real). Portar é copiar e trocar o nome.

🔒 **A queda automática tem critério:** cota (429), chave recusada (401/403),
queda do provedor (5xx) e rede caída → **tenta o outro**. Já **400/422 NÃO** — é
o *nosso* payload (destinatário inválido, corpo torto): repetiria igual do outro
lado e só queimaria a cota da reserva.

**Os 4 passos — o resto é clique:**

1. **Resend** — conta nova, só do DRG-Kronos. Verificar o **subdomínio**
   `kronos.drglobal.com.br`. 🔒 Subdomínio, **não** o domínio raiz: o DKIM do
   Resend é sempre `resend._domainkey` e colidiria com o que já está no ar em
   `drglobal.com.br` na conta antiga.
2. **Brevo** — conta nova, o **mesmo** subdomínio (o seletor DKIM dele é outro,
   os dois convivem).
3. **Variáveis no host:** `RESEND_API_KEY`, `BREVO_API_KEY` e
   `EMAIL_REMETENTE="DRG-Kronos <avisos@kronos.drglobal.com.br>"`.
4. Mandar um **e-mail de teste** e conferir **por qual provedor saiu**.

⚠️ **Nada de SMTP.** O Render bloqueia a saída nas portas 25/465/587 no plano
free (a 25 fica bloqueada até no pago, porque roda em EC2). Os dois provedores
falam HTTPS na 443. Gmail/Workspace/registro.br por SMTP dá **timeout**, com o
código absolutamente certo.

⚠️ O teto de 300/dia do Brevo é **compartilhado entre transacional e marketing**
na conta dele.

> Sem esses passos nada quebra: onde o código fica inerte sem chave, o aviso
> continua aparecendo no painel — só não sai por e-mail.
