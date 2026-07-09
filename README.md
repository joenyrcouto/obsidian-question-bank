# Banco de Questões (Obsidian Plugin)

Este repositório contém um sistema de gerenciamento de exercícios para Obsidian, projetado para otimizar o estudo ativo e o acompanhamento de desempenho. O sistema integra um **Plugin Personalizado** para gestão de fluxo de estudos e um **Template (Templater)** para automação de criação de notas.

## Funcionalidades Principais

### Plugin: Banco de Questões

O plugin permite transformar arquivos Markdown em uma interface interativa de estudos.

* **Modos de Estudo:**
* **Modo Livre:** Permite praticar questões com filtros personalizados (áreas, subáreas, tópicos e dificuldade).


* **Modo Prova:** Gera simulados cronometrados, permitindo a criação de arquivos de prova específicos.




* **Priorização Inteligente:**
* Calcula a **Utilidade Egoísta** (baseada no histórico pessoal de acertos/erros).


* Calcula a **Utilidade Relativa** (baseada na dificuldade da questão versus a taxa de erro do usuário em provas anteriores).




* **Estatísticas:** Painel visual que analisa o desempenho e a utilidade das questões por nível de dificuldade.


* **Gestão de Dados:** Edição de metadados (como dificuldade e status de resolução) diretamente na interface do cartão.



### Automação com Templater

O template incluído automatiza a criação de novas notas de exercício, garantindo consistência na estrutura YAML.

* **Renomeação Automática:** Formata o nome da nota conforme o padrão `x.x,AAAAMMDD-HHmm`.


* **Extração Hierárquica:** Identifica automaticamente a área e subárea a partir da nota da pasta onde o exercício está sendo criado.


* **Vínculos Inteligentes:** Cria automaticamente um `nota_link` (wikilink) conectando o exercício à nota da pasta de origem.



## Configuração

1. **Plugin:**
* Copie o código do plugin para a pasta `plugins` do seu Obsidian (ex: `.obsidian/plugins/obsidian-question-bank`).


* Nas configurações do Obsidian, ative o plugin "Banco de Questões".


* Defina o **Caminho Base** (diretório onde seus arquivos de exercícios estão armazenados) nas configurações do plugin.




2. **Template:**
* Copie o script fornecido para o seu modelo no plugin *Templater*.


* Ao criar uma nova nota, execute o comando do *Templater* para aplicar a estrutura YAML automaticamente.





## Estrutura de Metadados

O sistema espera que os arquivos Markdown contenham o seguinte *frontmatter* YAML para processamento correto:

```yaml
tipo: exercícios
tags:
  - area/subarea/topico
dificuldade: 5
resolvido: 0
erros: 0
acertos: 0
nota_link: "[[NomeDaPasta]]"

```

## Requisitos

* Obsidian (versão 1.0.0 ou superior).


* Plugin *Templater* instalado e configurado.
