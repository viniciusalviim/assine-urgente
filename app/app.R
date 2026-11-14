# Assine, Urgente! --------------------------------------------------------------
# Coloca a imagem de uma assinatura (PNG ou JPG) dentro de um PDF.
#
# O R comanda as telas e o biscoito da sorte. Tudo que mexe no PDF roda no
# navegador (www/app.js): o documento e a assinatura não são enviados para o R,
# não ficam salvos em lugar nenhum e somem quando a aba é fechada.

library(shiny)

eval(parse("frases.R", encoding = "UTF-8"))  # lista `frases`

seta_svg <- HTML('
<svg viewBox="0 0 120 60" aria-hidden="true">
  <path d="M4 22 H72 V6 L116 30 L72 54 V38 H4 Z" fill="#E3120B" stroke="#111"
        stroke-width="5" stroke-linejoin="round"/>
</svg>')

# Papelzinho dobrado em três partes (as laterais desdobram na animação)
papel_ui <- function() {
  parte <- function(classe, verso = TRUE) {
    div(class = paste("seg", classe),
        div(class = "face frente", div(class = "texto")),
        if (verso) div(class = "face verso"))
  }
  div(class = "dobras", parte("seg-e"), parte("seg-c", verso = FALSE), parte("seg-d"))
}

# Texto da janela "Como usar"
como_usar <- tags$template(id = "tpl-como-usar",
  tags$ol(class = "passos",
    tags$li(HTML("Digite seu nome e clique em <b>OK</b>.")),
    tags$li(HTML("Clique em <b>Escolher PDF</b> e abra o documento que vai ser assinado.")),
    tags$li(HTML("Para dar zoom, use os botões <b>+</b> e <b>&minus;</b>, a pinça do touchpad ou Ctrl + rodinha do mouse.")),
    tags$li(HTML("Clique em <b>Marcar área da assinatura</b> e desenhe um retângulo no lugar certo (clique e arraste).")),
    tags$li("Escolha a imagem da assinatura (PNG ou JPG). Ela preenche o retângulo."),
    tags$li(HTML("Ajuste pelos puxadores amarelos ou arraste a assinatura. Errou? <b>Apagar e recomeçar</b>.")),
    tags$li(HTML("Clique em <b>Pronto! Salvar PDF</b> e escolha a pasta e o nome do arquivo.")),
    tags$li("Pegue o seu biscoito da sorte!")
  ),
  tags$p(class = "nota",
         "Nada fica salvo: o PDF e a assinatura só existem nesta aba do navegador.")
)

ui <- tagList(
  tags$head(
    tags$meta(name = "viewport", content = "width=device-width, initial-scale=1"),
    tags$title("Assine, Urgente!"),
    tags$link(rel = "icon", href = "data:,"),
    tags$link(rel = "stylesheet", href = "estilo.css"),
    tags$script(src = "vendor/pdf.min.js"),
    tags$script(src = "vendor/pdf.worker.min.js"),
    tags$script(src = "vendor/pdf-lib.min.js"),
    tags$script(src = "app.js")
  ),
  como_usar,

  # 1. Boas-vindas ------------------------------------------------------------
  div(id = "tela-boasvindas", class = "tela ativa",
    div(class = "moldura penas"),   # imagem: www/penas.jpg
    div(class = "boasvindas-coluna",
      div(class = "logo-grande", includeHTML("logo.svg")),
      div(class = "cartao",
        h2(class = "titulo-boasvindas", "Bem-vinda!"),
        tags$label(`for` = "campo-nome", class = "rotulo", "Seu nome de usuário"),
        tags$input(id = "campo-nome", type = "text", class = "campo",
                   placeholder = "Digite seu nome", maxlength = "40",
                   autocomplete = "off"),
        div(id = "aviso-nome", class = "aviso"),
        div(class = "linha-botoes",
          tags$button(id = "bt-ajuda", class = "botao botao-ajuda",
                      span(class = "interrogacao", "?"), "Como usar"),
          tags$button(id = "bt-entrar", class = "botao botao-vermelho grande", "OK!")
        )
      )
    )
  ),

  # 2. Assinar ----------------------------------------------------------------
  div(id = "tela-assinar", class = "tela",
    div(class = "topo",
      div(class = "logo-mini", includeHTML("logo-mini.svg")),
      div(id = "dica", class = "dica", "Escolha o PDF que vai receber a assinatura.")
    ),
    div(class = "ferramentas",
      tags$button(id = "bt-pdf", class = "botao", "Escolher PDF"),
      div(class = "zoom",
        tags$button(id = "bt-menos", class = "botao quadrado", title = "Diminuir o zoom",
                    disabled = NA, HTML("&minus;")),
        span(id = "zoom-valor", "100%"),
        tags$button(id = "bt-mais", class = "botao quadrado", title = "Aumentar o zoom",
                    disabled = NA, "+")
      ),
      tags$button(id = "bt-area", class = "botao", disabled = NA, "Marcar área da assinatura"),
      tags$button(id = "bt-imagem", class = "botao", disabled = NA, "Escolher assinatura"),
      tags$button(id = "bt-apagar", class = "botao", disabled = NA, "Apagar e recomeçar"),
      tags$button(id = "bt-salvar", class = "botao botao-vermelho", disabled = NA, "Pronto! Salvar PDF")
    ),
    div(id = "visor", class = "visor",
      div(id = "vazio", class = "vazio",
        div(class = "balao", "Cadê o documento?"),
        tags$button(id = "bt-pdf-grande", class = "botao botao-amarelo grande", "Escolher PDF")
      ),
      div(id = "paginas", class = "paginas")
    )
  ),

  # 3. Biscoito da sorte ------------------------------------------------------
  div(id = "tela-biscoito", class = "tela",
    div(class = "parabens", uiOutput("parabens")),
    div(id = "palco", class = "palco",
      div(id = "seta", class = "seta", span("Clique aqui!"), seta_svg),
      includeHTML("biscoito.svg"),
      div(id = "papel", class = "papel", papel_ui())
    ),
    tags$button(id = "bt-recomecar", class = "botao botao-amarelo grande recomecar", "Recomeçar")
  )
)

# Quantas abas estão abertas (para fechar o R quando a última fechar)
abertas <- new.env()
abertas$n <- 0L

server <- function(input, output, session) {
  nome <- reactiveVal("")

  observeEvent(input$entrar, {
    n <- trimws(input$entrar)
    if (!nzchar(n)) {
      session$sendCustomMessage("aviso_nome", "Escreva o seu nome antes de continuar.")
      return()
    }
    nome(n)
    session$sendCustomMessage("tela", "assinar")
  })

  observeEvent(input$pdf_salvo, {
    session$sendCustomMessage("frase", sample(frases, 1))
    session$sendCustomMessage("tela", "biscoito")
  })

  # volta para a tela de assinar, pronta para outro PDF (o nome continua)
  observeEvent(input$recomecar, {
    session$sendCustomMessage("tela", "assinar")
  })

  output$parabens <- renderUI({
    tagList(
      h1(sprintf("Parabéns, %s, você agora tem o seu arquivo assinado.", nome())),
      h2("Receba o seu biscoito da sorte!!")
    )
  })
  outputOptions(output, "parabens", suspendWhenHidden = FALSE)

  # Versão local (aberta pelo .bat): quando a última aba fecha, o R fecha junto.
  # A espera de alguns segundos evita fechar se ela só recarregar a página.
  abertas$n <- abertas$n + 1L
  session$onSessionEnded(function() {
    abertas$n <- abertas$n - 1L
    if (isTRUE(getOption("assine_urgente.local"))) {
      later::later(function() if (abertas$n == 0L) stopApp(), 5)
    }
  })
}

shinyApp(ui, server)
