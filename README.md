# Controle de Entregas — GrupoPro

**https://controle.proativaaccounting.com.br**

Controle de conferência contábil por empresa. Página estática servida pelo
GitHub Pages sob domínio próprio, com os dados em Postgres (Supabase).

O DNS mora na HostGator (registro CNAME `controle` -> `khalylgerardo.github.io`);
o endereço antigo `khalylgerardo.github.io/controle-entregas` redireciona para cá.

## Como funciona

A tela tem **dois eixos independentes** que se combinam:

- **Escopo** — quais empresas entram: empresa, grupo empresarial, regime,
  periodicidade ou busca.
- **Itens** — quais itens aparecem, por caixas de seleção. Nada marcado = todos.

Cada cartão é um par (empresa, item). "Uma empresa com todos os seus itens" e
"um item em várias empresas" são apenas duas combinações da mesma tela.

Exemplo do dia a dia: marcar **Folha** e escolher o grupo **Kanpek** traz a folha
de todas as empresas do grupo numa tela só, para ir ticando conforme integra —
sem trocar de empresa a cada uma.

Quando há mais de uma empresa em cena, cada cartão ganha uma etiqueta com o
código e o nome dela. Com uma empresa só, aparece a ficha completa, o cartão `+`
para criar itens e a thread de observações gerais.

Acima de 400 cartões a tela pede um recorte em vez de renderizar — não há leitura
útil numa parede de mil cartões.

Escolha a empresa no seletor do topo. A ficha abre com um card por item de
conferência — cada card tem **Sim / Não** e um campo de observação daquele item.
O card `+` no fim da grade cria um item novo só para aquela empresa.
Qualquer card pode ser renomeado (clique no título) ou excluído — inclusive os
que vêm por padrão, porque o que vale numa empresa não vale em outra. A exclusão
pede confirmação em dois cliques e vale só para aquela empresa.

Abaixo dos cards fica a thread de **observações gerais** da empresa: cada
registro fica datado e pode ser editado ou excluído.

## Acesso

Entrada por usuário e senha. O usuário é `nome.sobrenome`; por baixo o Supabase
Auth trabalha com `usuario@controle.proativaaccounting.com.br`, mas isso não
aparece para quem usa. Nenhum e-mail é enviado — as contas nascem confirmadas.

Todo acesso novo começa com a senha `123456` e é **obrigado a trocar** no
primeiro login. Um admin pode redefinir a senha de alguém de volta para `123456`,
e a exigência de troca volta junto.

Só administradores criam, removem, promovem ou redefinem acessos. Dentro do app
não há distinção: qualquer pessoa autenticada edita tudo.

Regra de senha: mínimo 6 caracteres, e não pode ser igual à inicial. Mais nada —
foi decisão do time, e por isso a checagem de senhas vazadas do Supabase fica
desligada (ela rejeitaria `123456` e inviabilizaria o fluxo).

As operações que exigem a chave de serviço (criar, remover, redefinir) vivem na
Edge Function `admin-usuarios`, que confere no servidor se quem chamou é admin.
A chave de serviço nunca chega ao navegador. Os registros guardam a data, não o
autor.

Duas saídas em PDF:

- **PDF da empresa** — ficha completa: todos os itens, situação, observações de
  cada um e a thread geral.
- **PDF do item** — na vista por item: cada empresa, a situação daquele item,
  meses e observação.
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
