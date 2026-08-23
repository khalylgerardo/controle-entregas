# Controle de Entregas — GrupoPro

Controle de conferência contábil por empresa. Página estática servida pelo
GitHub Pages, com os dados em Postgres (Supabase).

## Como funciona

Escolha a empresa no seletor do topo. A ficha abre com um card por item de
conferência — cada card tem **Sim / Não** e um campo de observação daquele item.
O card `+` no fim da grade cria um item novo só para aquela empresa.

Abaixo dos cards fica a thread de **observações gerais** da empresa: cada
registro é assinado com o nome preenchido em "Seu nome" e pode ser editado ou
excluído.

Duas saídas em PDF:

- **PDF da empresa** — ficha completa: todos os itens, situação, observações de
  cada um e a thread geral.
- **PDF geral** — panorama das empresas que estiverem no filtro, com o progresso
  de cada uma.

Tudo é ao vivo: quem estiver com a página aberta vê a marcação do outro na hora,
sem recarregar.

## Estrutura

| Arquivo      | Papel                                                        |
|--------------|--------------------------------------------------------------|
| `index.html` | Casca da página                                              |
| `app.js`     | Estado, Supabase, tempo real, interações                     |
| `pdf.js`     | Gerador de PDF próprio, sem dependência externa              |
| `styles.css` | Tokens de tema (claro/escuro) e componentes                  |

## Dados

Nenhum dado de cliente vive neste repositório — ele é público e leva só o app.
Empresas, itens e observações ficam nas tabelas `ctrl_*` do Supabase.

A chave publicável no `app.js` é pública de propósito: o controle foi definido
como link aberto, sem login. Ela alcança apenas as tabelas `ctrl_*`; as demais
tabelas do banco exigem usuário autenticado e permanecem inacessíveis por ela.

**Consequência assumida:** quem tiver o endereço consegue ver e editar o
controle. A página vai com `noindex` para não aparecer em buscador, mas isso não
substitui autenticação. Para fechar o acesso, o caminho é habilitar Supabase Auth
e trocar as políticas de `anon` para `authenticated`.
