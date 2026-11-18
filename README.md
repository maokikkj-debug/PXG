# Heróis do Olimpo — Arquivo do Acampamento

Aplicação responsiva de fichas para o RPG autoral Heróis do Olimpo. A interface segue a referência de mármore claro, azul profundo e dourado; as regras, progenitores divinos e itens foram organizados a partir do Livro do Jogador fornecido.

## Recursos

- Cadastro, login, recuperação de senha e sessão com Supabase Auth.
- Fichas persistidas no Supabase, com edição pelo próprio jogador e administração de campanha pelo mestre.
- Painéis de fichas, progressão, catálogo de itens e consulta rápida das regras.
- Retrato privado por ficha, validado para PNG/JPEG/WebP até 5 MB.
- RLS: jogador acessa suas fichas; `app_metadata.role = master` permite ao mestre administrar as fichas da campanha.
- Exportação JSON da campanha para a conta de mestre.
- Distribuição de XP e regras de combate testadas em `npm test`.

## Banco de dados

O projeto usa a tabela existente `public.rpg_characters`. A migração `database-migration.sql` adiciona o diretório de contas e o bucket privado de retratos. Aplique a migração uma vez no projeto Supabase conectado antes de liberar o app.

Somente a chave publicável do Supabase é usada no navegador. Nunca configure `service_role` ou chave secreta no cliente. A chave publicável é segura no repositório porque as tabelas e o armazenamento usam RLS.

## Desenvolvimento e publicação

```sh
npm test
npm run build
```

O build grava a versão estática em `dist/`. A Vercel deve usar `npm run build` e `dist`, com `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY` configuradas no ambiente de produção. A compilação local usa `config.js`; essa chave é publicável e deve ser protegida por políticas RLS no banco.

## Notas de segurança

- O campo `role` precisa estar em `app_metadata`; valores de `user_metadata` não são usados para conceder privilégios.
- O mestre só pode listar contas que já acessaram o site e receberam um registro em `rpg_profiles`.
- Retratos permanecem em bucket privado e a URL assinada é gerada ao abrir a sessão, sem armazenar o token temporário na ficha.
- Ative a confirmação de e-mail conforme a política da mesa; o app respeita a configuração atual do Supabase Auth.

## Central do Mestre

`master-schema.sql` configura as tabelas privadas e a função de recompensas. Aplique a migração no projeto Supabase antes de liberar a interface. Use o campo confiável `app_metadata.role = master` atribuído pelo administrador. O servidor aplica RLS; o menu e os arquivos estáticos não contêm a campanha.

Para importar o livro em um ambiente autorizado, execute `python3 prepare-master-book.py caminho-do-livro.pdf diretorio-privado-fora-do-repositorio` com Poppler instalado. A ferramenta prepara CSV, JSON e um script de instalação para o SQL Editor. Use o script integral somente em uma instalação nova. Se o esquema já estiver aplicado, importe apenas a linha do livro para `public.rpg_master_books`. Mantenha tanto o PDF quanto a saída da importação fora de repositórios, builds e prévias públicas.

`master-verify.sql` verifica o conteúdo importado e a recusa de leitura/registro de XP em uma sessão com papel de jogador, incluindo metadados editáveis que não concedem autorização. O controle de XP mantém a evolução existente e evita duplicar uma origem para o mesmo personagem. Use a mesma origem para XP por objetivo ou combate.
