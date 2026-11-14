# Abre o Assine, Urgente! no navegador padrão. Quem chama este arquivo é o
# "ABRIR ASSINE URGENTE.bat" (basta dar dois cliques nele).

# instala na biblioteca do usuário, que não pede permissão de administrador
biblioteca <- Sys.getenv("R_LIBS_USER")
dir.create(biblioteca, recursive = TRUE, showWarnings = FALSE)
.libPaths(c(biblioteca, .libPaths()))

if (!requireNamespace("shiny", quietly = TRUE)) {
  message("Instalando o pacote shiny (só na primeira vez; precisa de internet)...")
  install.packages("shiny", lib = biblioteca, repos = "https://cloud.r-project.org")
}

options(assine_urgente.local = TRUE)
message("\nAssine, Urgente! aberto no navegador.")
message("Esta janela fecha sozinha quando você fechar a aba do app.\n")

shiny::runApp(".", launch.browser = TRUE, host = "127.0.0.1", quiet = TRUE)
