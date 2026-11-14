/* Assine, Urgente! — parte que roda no navegador
 *
 * - pdf.js mostra o PDF (zoom por botões, pinça no touchpad e Ctrl + rodinha)
 * - pdf-lib grava a imagem da assinatura dentro do PDF original
 * Nada é enviado ao R nem guardado: o PDF e a imagem só existem na memória
 * desta aba e são descartados depois de salvar (ou ao fechar a aba).
 */
(function () {
  "use strict";

  const ZOOM_MIN = 0.25, ZOOM_MAX = 5, TAM_MIN = 8;

  const S = {
    bytes: null,        // PDF original (ArrayBuffer)
    nomeArquivo: "",
    doc: null,          // documento do pdf.js
    paginas: [],        // { page, vp, div, canvas, tarefa, feita }
    escala: 1,
    modoArea: false,
    area: null,         // { pag, x, y, w, h } em pontos do PDF (origem no topo)
    areaEl: null,
    assin: null,        // { pag, x, y, w, h, png, url }
    assinEl: null,
    visiveis: new Set()
  };

  let visor, paginasEl, observador, tempoRender;

  const $id = (id) => document.getElementById(id);
  const limitar = (v, a, b) => Math.min(b, Math.max(a, v));

  function el(tag, classe, texto) {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto != null) e.textContent = texto;
    return e;
  }

  /* ------------------------------------------------------------------ telas */

  function mostrarTela(nome) {
    document.querySelectorAll(".tela").forEach((t) => {
      t.classList.toggle("ativa", t.id === "tela-" + nome);
    });
    if (nome === "biscoito") reiniciarBiscoito();
  }

  function entrar() {
    $id("aviso-nome").textContent = "";
    Shiny.setInputValue("entrar", $id("campo-nome").value, { priority: "event" });
  }

  /* ---------------------------------------------------------- janelinhas */

  function fecharModal() {
    document.querySelectorAll(".modal-fundo").forEach((m) => m.remove());
  }

  // o = { titulo, texto, no (conteúdo pronto), larga, campo (valor inicial),
  //       botoes: [{ rotulo, classe, acao }] }
  function modal(o) {
    fecharModal();
    const fundo = el("div", "modal-fundo");
    const caixa = el("div", "modal-caixa" + (o.larga ? " larga" : ""));
    if (o.titulo) caixa.appendChild(el("h3", null, o.titulo));
    if (o.texto) caixa.appendChild(el("p", null, o.texto));
    if (o.no) caixa.appendChild(o.no);
    let campo = null;
    if (o.campo != null) {
      campo = el("input", "campo");
      campo.type = "text";
      campo.value = o.campo;
      caixa.appendChild(campo);
    }
    const linha = el("div", "modal-botoes");
    (o.botoes || [{ rotulo: "OK", classe: "botao-amarelo" }]).forEach((b) => {
      const bt = el("button", "botao " + (b.classe || ""), b.rotulo);
      bt.addEventListener("click", () => {
        const valor = campo ? campo.value : null;
        fecharModal();
        if (b.acao) b.acao(valor);
      });
      linha.appendChild(bt);
    });
    caixa.appendChild(linha);
    fundo.appendChild(caixa);
    document.body.appendChild(fundo);
    if (campo) {
      campo.focus();
      campo.select();
      campo.addEventListener("keydown", (e) => {
        if (e.key === "Enter") linha.lastChild.click();
      });
    } else {
      linha.lastChild.focus();
    }
  }

  function aviso(titulo, texto) {
    modal({ titulo, texto, botoes: [{ rotulo: "Entendi", classe: "botao-amarelo" }] });
  }

  // Seletor de arquivos sem passar pelo Shiny (o arquivo não sai do navegador)
  function escolherArquivo(aceita, quandoEscolher) {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = aceita;
    inp.addEventListener("change", () => {
      if (inp.files && inp.files[0]) quandoEscolher(inp.files[0]);
    });
    inp.click();
  }

  /* -------------------------------------------------------- estado / dicas */

  function atualizar() {
    const temDoc = !!S.doc;
    $id("bt-menos").disabled = !temDoc;
    $id("bt-mais").disabled = !temDoc;
    $id("bt-area").disabled = !temDoc;
    $id("bt-area").classList.toggle("ligado", S.modoArea);
    $id("bt-imagem").disabled = !(S.area || S.assin);
    $id("bt-apagar").disabled = !(S.area || S.assin);
    $id("bt-salvar").disabled = !S.assin;
    $id("vazio").classList.toggle("escondido", temDoc);
    visor.classList.toggle("modo-area", S.modoArea);
    $id("zoom-valor").textContent = Math.round(S.escala * 100) + "%";

    let dica;
    if (!temDoc) dica = "Escolha o PDF que vai receber a assinatura.";
    else if (S.modoArea) dica = "Clique no documento e arraste para desenhar o retângulo da assinatura.";
    else if (S.assin) dica = "Arraste a assinatura ou os puxadores amarelos para ajustar. Ficou bom? Clique em PRONTO!";
    else if (S.area) dica = "Agora escolha a imagem da assinatura (PNG ou JPG).";
    else dica = "Clique em MARCAR ÁREA e desenhe onde vai a assinatura. Zoom: botões, pinça ou Ctrl + rodinha.";
    $id("dica").textContent = dica;
  }

  /* -------------------------------------------------------------- abrir PDF */

  async function abrirPdf(arquivo) {
    if (!/\.pdf$/i.test(arquivo.name) && arquivo.type !== "application/pdf") {
      aviso("Ops!", "Esse arquivo não é um PDF.");
      return;
    }
    const bytes = await arquivo.arrayBuffer();

    let doc;
    try {
      doc = await pdfjsLib.getDocument({
        data: new Uint8Array(bytes.slice(0)),
        standardFontDataUrl: "vendor/standard_fonts/",
        isEvalSupported: false
      }).promise;
    } catch (e) {
      if (e && e.name === "PasswordException") {
        aviso("PDF com senha", "Esse PDF pede senha para abrir, então não dá para assinar por aqui.");
      } else {
        aviso("Ops!", "Não consegui abrir esse PDF. Ele pode estar corrompido.");
      }
      return;
    }

    // confere logo se o pdf-lib vai conseguir gravar nele
    try {
      await PDFLib.PDFDocument.load(bytes.slice(0));
    } catch (e) {
      doc.destroy();
      aviso("PDF protegido", "Esse PDF está protegido contra alterações, então não dá para colocar a assinatura nele.");
      return;
    }

    limparDocumento();
    S.bytes = bytes;
    S.nomeArquivo = arquivo.name;
    S.doc = doc;

    let maiorLargura = 0;
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      const div = el("div", "pagina");
      div.dataset.pag = String(i - 1);
      const canvas = document.createElement("canvas");
      div.appendChild(canvas);
      paginasEl.appendChild(div);
      S.paginas.push({ page, vp, div, canvas, tarefa: null, feita: 0 });
      maiorLargura = Math.max(maiorLargura, vp.width);
      observador.observe(div);
    }

    S.escala = limitar((visor.clientWidth - 80) / maiorLargura, ZOOM_MIN, 1.6);
    aplicarEscala();
    visor.scrollTop = 0;
    visor.scrollLeft = 0;
    atualizar();
  }

  function limparDocumento() {
    apagarAssinatura();
    S.modoArea = false;
    S.paginas.forEach((p) => {
      if (p.tarefa) p.tarefa.cancel();
      observador.unobserve(p.div);
    });
    S.paginas = [];
    S.visiveis.clear();
    paginasEl.textContent = "";
    if (S.doc) S.doc.destroy();
    S.doc = null;
    S.bytes = null;
    S.nomeArquivo = "";
  }

  /* ------------------------------------------------------ desenho e zoom */

  function aplicarEscala() {
    S.paginas.forEach((p) => {
      p.div.style.width = p.vp.width * S.escala + "px";
      p.div.style.height = p.vp.height * S.escala + "px";
    });
    if (S.areaEl) posicionar(S.areaEl, S.area);
    if (S.assinEl) posicionar(S.assinEl, S.assin);
    $id("zoom-valor").textContent = Math.round(S.escala * 100) + "%";
    clearTimeout(tempoRender);
    tempoRender = setTimeout(() => S.visiveis.forEach((p) => renderizar(p)), 140);
  }

  function renderizar(p) {
    if (p.feita === S.escala) return;
    if (p.tarefa) p.tarefa.cancel();
    const dpr = window.devicePixelRatio || 1;
    // limita o tamanho do desenho em zoom muito alto (memória)
    const maxEscala = Math.sqrt(16e6 / (p.vp.width * p.vp.height));
    const vp = p.page.getViewport({ scale: Math.min(S.escala * dpr, maxEscala) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    const escalaPedida = S.escala;
    const tarefa = p.page.render({ canvasContext: canvas.getContext("2d"), viewport: vp });
    p.tarefa = tarefa;
    tarefa.promise.then(() => {
      if (!p.div.isConnected) return;
      p.div.replaceChild(canvas, p.canvas);
      p.canvas = canvas;
      p.feita = escalaPedida;
      p.tarefa = null;
    }).catch(() => {});
  }

  function paginaNoPonto(y) {
    let melhor = null, dist = Infinity;
    S.paginas.forEach((p) => {
      const r = p.div.getBoundingClientRect();
      const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      if (d < dist) { dist = d; melhor = p; }
    });
    return melhor;
  }

  // muda o zoom mantendo parado o ponto sob o cursor (ou o centro da tela)
  function definirEscala(nova, cx, cy) {
    if (!S.doc) return;
    nova = limitar(nova, ZOOM_MIN, ZOOM_MAX);
    if (Math.abs(nova - S.escala) < 1e-4) return;
    const rv = visor.getBoundingClientRect();
    if (cx == null) { cx = rv.left + visor.clientWidth / 2; cy = rv.top + visor.clientHeight / 2; }
    const alvo = paginaNoPonto(cy);
    const r1 = alvo.div.getBoundingClientRect();
    const fx = (cx - r1.left) / r1.width, fy = (cy - r1.top) / r1.height;
    S.escala = nova;
    aplicarEscala();
    const r2 = alvo.div.getBoundingClientRect();
    visor.scrollLeft += r2.left + fx * r2.width - cx;
    visor.scrollTop += r2.top + fy * r2.height - cy;
  }

  function prepararZoom() {
    $id("bt-mais").addEventListener("click", () => definirEscala(S.escala * 1.25));
    $id("bt-menos").addEventListener("click", () => definirEscala(S.escala / 1.25));

    // pinça no touchpad e Ctrl + rodinha chegam como "wheel" com ctrlKey
    visor.addEventListener("wheel", (e) => {
      if (!e.ctrlKey || !S.doc) return;
      e.preventDefault();
      let dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      dy = limitar(dy, -40, 40);
      definirEscala(S.escala * Math.exp(-dy * 0.008), e.clientX, e.clientY);
    }, { passive: false });

    // pinça no Safari (Mac)
    let base = 1;
    visor.addEventListener("gesturestart", (e) => { e.preventDefault(); base = S.escala; });
    visor.addEventListener("gesturechange", (e) => {
      e.preventDefault();
      definirEscala(base * e.scale, e.clientX, e.clientY);
    });
  }

  /* --------------------------------------------------- área da assinatura */

  function posicionar(elemento, c) {
    elemento.style.left = c.x * S.escala + "px";
    elemento.style.top = c.y * S.escala + "px";
    elemento.style.width = c.w * S.escala + "px";
    elemento.style.height = c.h * S.escala + "px";
  }

  function pontoNaPagina(p, e) {
    const r = p.div.getBoundingClientRect();
    return {
      x: limitar((e.clientX - r.left) / S.escala, 0, p.vp.width),
      y: limitar((e.clientY - r.top) / S.escala, 0, p.vp.height)
    };
  }

  function apagarArea() {
    if (S.areaEl) S.areaEl.remove();
    S.area = null;
    S.areaEl = null;
  }

  function apagarAssinatura() {
    apagarArea();
    if (S.assinEl) S.assinEl.remove();
    if (S.assin) URL.revokeObjectURL(S.assin.url);
    S.assin = null;
    S.assinEl = null;
  }

  function ligarModoArea(ligar) {
    S.modoArea = ligar;
    atualizar();
  }

  function prepararDesenho() {
    paginasEl.addEventListener("pointerdown", (e) => {
      if (!S.modoArea || e.button !== 0) return;
      const div = e.target.closest(".pagina");
      if (!div) return;
      e.preventDefault();

      apagarAssinatura();
      const indice = Number(div.dataset.pag);
      const p = S.paginas[indice];
      const inicio = pontoNaPagina(p, e);
      const ret = el("div", "area");
      ret.appendChild(el("span", null, "Assinatura aqui"));
      div.appendChild(ret);
      let atual = { pag: indice, x: inicio.x, y: inicio.y, w: 0, h: 0 };
      posicionar(ret, atual);
      div.setPointerCapture(e.pointerId);

      const mover = (ev) => {
        const q = pontoNaPagina(p, ev);
        atual = {
          pag: indice,
          x: Math.min(inicio.x, q.x), y: Math.min(inicio.y, q.y),
          w: Math.abs(q.x - inicio.x), h: Math.abs(q.y - inicio.y)
        };
        posicionar(ret, atual);
      };
      const soltar = () => {
        div.removeEventListener("pointermove", mover);
        div.removeEventListener("pointerup", soltar);
        div.removeEventListener("pointercancel", soltar);
        if (atual.w * S.escala < 12 || atual.h * S.escala < 12) {
          ret.remove();
          return;   // foi só um clique: continua no modo de desenhar
        }
        S.area = atual;
        S.areaEl = ret;
        ligarModoArea(false);
        modal({
          titulo: "Área marcada!",
          texto: "Quer escolher a imagem da assinatura ou fazer outra área de seleção?",
          botoes: [
            { rotulo: "Fazer outra área", acao: () => { apagarArea(); ligarModoArea(true); } },
            { rotulo: "Escolher a assinatura", classe: "botao-vermelho", acao: escolherImagem }
          ]
        });
      };
      div.addEventListener("pointermove", mover);
      div.addEventListener("pointerup", soltar);
      div.addEventListener("pointercancel", soltar);
    });
  }

  /* ------------------------------------------------- imagem da assinatura */

  function escolherImagem() {
    escolherArquivo("image/png,image/jpeg,.png,.jpg,.jpeg", colocarImagem);
  }

  function carregarImagem(url) {
    return new Promise((ok, falha) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = falha;
      img.src = url;
    });
  }

  async function colocarImagem(arquivo) {
    if (!/^image\/(png|jpeg)$/.test(arquivo.type) && !/\.(png|jpe?g)$/i.test(arquivo.name)) {
      aviso("Ops!", "A assinatura precisa ser uma imagem PNG ou JPG.");
      return;
    }
    const alvo = S.area || S.assin;
    if (!alvo) return;

    const urlOriginal = URL.createObjectURL(arquivo);
    let img;
    try {
      img = await carregarImagem(urlOriginal);
    } catch (e) {
      aviso("Ops!", "Não consegui abrir essa imagem.");
      return;
    } finally {
      URL.revokeObjectURL(urlOriginal);
    }

    // converte para PNG (respeita a rotação de fotos de celular e limita o tamanho)
    const k = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * k));
    const h = Math.max(1, Math.round(img.naturalHeight * k));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d").drawImage(img, 0, 0, w, h);
    const blob = await new Promise((ok) => c.toBlob(ok, "image/png"));
    const png = new Uint8Array(await blob.arrayBuffer());

    // a imagem preenche o retângulo, sem deformar
    const razao = w / h;
    let bw = alvo.w, bh = alvo.w / razao;
    if (bh > alvo.h) { bh = alvo.h; bw = alvo.h * razao; }
    const novo = {
      pag: alvo.pag,
      x: alvo.x + (alvo.w - bw) / 2,
      y: alvo.y + (alvo.h - bh) / 2,
      w: bw, h: bh,
      png, url: URL.createObjectURL(blob)
    };

    apagarAssinatura();
    S.assin = novo;
    criarCaixaAssinatura();
    atualizar();
  }

  function criarCaixaAssinatura() {
    const caixa = el("div", "assinatura");
    const img = el("img");
    img.src = S.assin.url;
    img.alt = "Assinatura";
    img.draggable = false;
    caixa.appendChild(img);
    ["nw", "n", "ne", "e", "se", "s", "sw", "w"].forEach((d) => {
      const pux = el("span", "puxador");
      pux.dataset.d = d;
      caixa.appendChild(pux);
    });
    S.paginas[S.assin.pag].div.appendChild(caixa);
    S.assinEl = caixa;
    posicionar(caixa, S.assin);

    caixa.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || S.modoArea) return;
      e.preventDefault();
      e.stopPropagation();
      const d = e.target.dataset.d || "mover";
      const ini = Object.assign({}, S.assin);
      const p = S.paginas[ini.pag];
      const x0 = e.clientX, y0 = e.clientY;
      caixa.setPointerCapture(e.pointerId);
      const mover = (ev) => {
        const dx = (ev.clientX - x0) / S.escala, dy = (ev.clientY - y0) / S.escala;
        Object.assign(S.assin, ajustarCaixa(ini, d, dx, dy, p.vp.width, p.vp.height));
        posicionar(caixa, S.assin);
      };
      const soltar = () => {
        caixa.removeEventListener("pointermove", mover);
        caixa.removeEventListener("pointerup", soltar);
        caixa.removeEventListener("pointercancel", soltar);
      };
      caixa.addEventListener("pointermove", mover);
      caixa.addEventListener("pointerup", soltar);
      caixa.addEventListener("pointercancel", soltar);
    });
  }

  // cantos mudam o tamanho sem deformar; laterais esticam; o meio arrasta
  function ajustarCaixa(i, d, dx, dy, W, H) {
    if (d === "mover") {
      return { x: limitar(i.x + dx, 0, W - i.w), y: limitar(i.y + dy, 0, H - i.h), w: i.w, h: i.h };
    }
    const hx = d.includes("e") ? 1 : d.includes("w") ? -1 : 0;
    const hy = d.includes("s") ? 1 : d.includes("n") ? -1 : 0;
    const fixoX = hx === 1 ? i.x : i.x + i.w;          // lado que não se mexe
    const fixoY = hy === 1 ? i.y : i.y + i.h;
    const livreX = hx === 1 ? W - fixoX : fixoX;       // espaço até a borda da página
    const livreY = hy === 1 ? H - fixoY : fixoY;
    let w = i.w, h = i.h;
    if (hx && hy) {
      let s = Math.max((i.w + hx * dx) / i.w, (i.h + hy * dy) / i.h);
      s = limitar(s, TAM_MIN / Math.min(i.w, i.h), Math.min(livreX / i.w, livreY / i.h));
      w = i.w * s;
      h = i.h * s;
    } else if (hx) {
      w = limitar(i.w + hx * dx, TAM_MIN, livreX);
    } else {
      h = limitar(i.h + hy * dy, TAM_MIN, livreY);
    }
    return {
      x: hx === -1 ? fixoX - w : hx === 1 ? fixoX : i.x,
      y: hy === -1 ? fixoY - h : hy === 1 ? fixoY : i.y,
      w, h
    };
  }

  /* ---------------------------------------------------------------- salvar */

  async function montarPdf() {
    const { PDFDocument, degrees, BlendMode } = PDFLib;
    const pdf = await PDFDocument.load(S.bytes.slice(0));
    const imagem = await pdf.embedPng(S.assin.png);
    const a = S.assin;
    const vp = S.paginas[a.pag].vp;
    // cantos inferiores da assinatura como aparecem na tela, em coordenadas do PDF
    // (assim funciona também em páginas giradas)
    const [x0, y0] = vp.convertToPdfPoint(a.x, a.y + a.h);
    const [x1, y1] = vp.convertToPdfPoint(a.x + a.w, a.y + a.h);
    const angulo = Math.round(Math.atan2(y1 - y0, x1 - x0) * 180 / Math.PI);
    pdf.getPage(a.pag).drawImage(imagem, {
      x: x0, y: y0, width: a.w, height: a.h,
      rotate: degrees(angulo),
      blendMode: BlendMode.Multiply   // fundo branco de JPG não cobre o documento
    });
    return pdf.save();
  }

  async function salvar() {
    if (!S.assin) return;
    const sugerido = S.nomeArquivo.replace(/\.pdf$/i, "") + "_assinado.pdf";

    // Chrome e Edge: janela "Salvar como" (escolhe pasta e nome)
    if (window.showSaveFilePicker) {
      let destino = null;
      try {
        destino = await window.showSaveFilePicker({
          suggestedName: sugerido,
          types: [{ description: "Documento PDF", accept: { "application/pdf": [".pdf"] } }]
        });
      } catch (e) {
        if (e && e.name === "AbortError") return;   // ela cancelou
      }
      if (destino) {
        try {
          const bytes = await montarPdf();
          const saida = await destino.createWritable();
          await saida.write(bytes);
          await saida.close();
          concluir();
        } catch (e) {
          aviso("Ops!", "Não consegui salvar o arquivo. Tente outra pasta.");
        }
        return;
      }
    }

    // Outros navegadores: pergunta o nome e baixa
    modal({
      titulo: "Salvar PDF",
      texto: "Qual vai ser o nome do arquivo?",
      campo: sugerido,
      botoes: [
        { rotulo: "Cancelar" },
        { rotulo: "Salvar", classe: "botao-vermelho", acao: baixar }
      ]
    });
  }

  async function baixar(nome) {
    nome = (nome || "").trim().replace(/[\\/:*?"<>|]+/g, "-") || "assinado";
    if (!/\.pdf$/i.test(nome)) nome += ".pdf";
    try {
      const bytes = await montarPdf();
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const a = el("a");
      a.href = url;
      a.download = nome;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      concluir();
    } catch (e) {
      aviso("Ops!", "Não consegui gerar o arquivo.");
    }
  }

  function concluir() {
    limparDocumento();   // descarta PDF e assinatura da memória
    atualizar();
    Shiny.setInputValue("pdf_salvo", Date.now(), { priority: "event" });
  }

  /* ------------------------------------------------------- biscoito da sorte */

  let quebrado = false;

  function reiniciarBiscoito() {
    quebrado = false;
    $id("palco").className = "palco";
    $id("bt-recomecar").classList.remove("visivel");
  }

  function quebrarBiscoito() {
    if (quebrado) return;
    quebrado = true;
    const palco = $id("palco");
    palco.classList.add("treme");
    setTimeout(() => palco.classList.add("quebrado"), 450);
    setTimeout(() => palco.classList.add("papel-sai"), 750);
    setTimeout(() => palco.classList.add("desdobrado"), 1500);
    setTimeout(() => $id("bt-recomecar").classList.add("visivel"), 2400);
  }

  function comoUsar() {
    modal({
      titulo: "Como usar",
      no: $id("tpl-como-usar").content.cloneNode(true),
      larga: true,
      botoes: [{ rotulo: "Entendi!", classe: "botao-amarelo" }]
    });
  }

  /* ---------------------------------------------------------------- início */

  document.addEventListener("DOMContentLoaded", () => {
    // pdf.worker.min.js já foi carregado na página, então o pdf.js usa ele direto
    pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";

    visor = $id("visor");
    paginasEl = $id("paginas");
    observador = new IntersectionObserver((entradas) => {
      entradas.forEach((en) => {
        const p = S.paginas[Number(en.target.dataset.pag)];
        if (!p) return;
        if (en.isIntersecting) { S.visiveis.add(p); renderizar(p); }
        else S.visiveis.delete(p);
      });
    }, { root: visor, rootMargin: "400px" });

    // boas-vindas
    $id("bt-entrar").addEventListener("click", entrar);
    $id("campo-nome").addEventListener("keydown", (e) => { if (e.key === "Enter") entrar(); });
    $id("bt-ajuda").addEventListener("click", comoUsar);

    // assinatura
    const pedirPdf = () => escolherArquivo("application/pdf,.pdf", abrirPdf);
    $id("bt-pdf").addEventListener("click", pedirPdf);
    $id("bt-pdf-grande").addEventListener("click", pedirPdf);
    $id("bt-area").addEventListener("click", () => ligarModoArea(!S.modoArea));
    $id("bt-imagem").addEventListener("click", escolherImagem);
    $id("bt-apagar").addEventListener("click", () => { apagarAssinatura(); ligarModoArea(false); });
    $id("bt-salvar").addEventListener("click", salvar);
    prepararZoom();
    prepararDesenho();
    atualizar();

    // biscoito
    $id("biscoito").addEventListener("click", quebrarBiscoito);
    $id("bt-recomecar").addEventListener("click", () => {
      Shiny.setInputValue("recomecar", Date.now(), { priority: "event" });
    });

    // mensagens do R
    Shiny.addCustomMessageHandler("tela", mostrarTela);
    Shiny.addCustomMessageHandler("aviso_nome", (txt) => { $id("aviso-nome").textContent = txt; });
    Shiny.addCustomMessageHandler("frase", (txt) => {
      document.querySelectorAll("#papel .texto").forEach((t) => { t.textContent = txt; });
    });

    $id("campo-nome").focus();
  });
})();
