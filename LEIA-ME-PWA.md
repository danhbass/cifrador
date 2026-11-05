# Cifrador — estrutura de apresentação, demonstração e atualização PWA

## Estrutura
- `/` — página pública de apresentação.
- `/demo/` — demonstração interativa com dados fictícios em memória (não usa localStorage).
- `/app/` — aplicação original, preservada, com os mesmos arquivos e lógica.
- `version.json` — versão publicada e novidades.
- `version-history.json` — histórico de versões.
- `update.js` — consulta de versão e interface de atualização.
- `sw.js` — cache offline e ativação sob confirmação.

## Publicar uma versão
1. Desenvolva e teste normalmente.
2. Atualize `version.json` (campo `version`, data, título e `changes`).
3. Acrescente a entrada correspondente em `version-history.json`.
4. Publique todos os arquivos no GitHub.
5. Aguarde a hospedagem concluir a publicação.

A versão executada é indicada por `meta[name=app-version]` em `app/index.html`. **Atenção:** ao publicar uma versão nova, altere também esse meta para o número da versão que está sendo efetivamente entregue. O `version.json` não consegue, sozinho, provar que os novos arquivos HTML/JS já foram publicados; por isso o processo correto é publicar o conjunto de arquivos da versão e atualizar os dois números no mesmo commit.

## Dados
O app original usa localStorage. Esta implementação não limpa localStorage, sessionStorage nem IndexedDB. A demonstração tem estado apenas em memória e é descartada ao recarregar. Recomenda-se fazer backup pelo recurso já existente antes de grandes atualizações.

## Service Worker
A consulta do `version.json` é feita com `cache: no-store`. Ao confirmar atualização, o cliente registra `sw.js?v=<versão>`. O worker instala os recursos essenciais em cache versionado e aguarda uma mensagem enviada após a ação explícita do usuário para executar `skipWaiting()`. O cache anterior só é removido no evento `activate`, depois de a instalação do novo cache ter concluído.

A estratégia de URL versionada depende de suporte ao ciclo de vida padrão de Service Workers dos navegadores modernos. Como fallback, o conteúdo de `sw.js` também é verificado pelo navegador quando ocorre registro/atualização. Em futuras publicações, se um navegador específico não reconhecer a mudança de query string, a alternativa mais confiável é alterar um comentário/constante no `sw.js` (ou usar uma URL física distinta), o que força a verificação do script.

## Limitações e validação
- Não há teste físico de Android/iOS neste ambiente.
- O botão de instalação depende de `beforeinstallprompt` quando o navegador oferece esse evento. No iOS, o usuário precisa usar Compartilhar > Adicionar à Tela de Início no Safari.
- A barra de progresso indica etapas do processo, não percentual real de bytes baixados: a API padrão de instalação do Service Worker não expõe progresso agregado confiável.
- `skipWaiting()` só é enviado depois do clique em Atualizar agora. A ativação afeta o escopo inteiro; outras abas sob o mesmo escopo poderão receber o novo controller e recarregar conforme a política do navegador. Dados locais permanecem no mesmo origin.
- A recuperação de falha de instalação mantém o worker anterior ativo. Não existe rollback automático garantido para uma versão que foi ativada e contém defeito de aplicação; publique uma versão corrigida com número superior.
- Para produção, configure a hospedagem para não armazenar `version.json` em cache e mantenha HTTPS.
