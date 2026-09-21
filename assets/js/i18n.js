/*
 * Strings that the demos generate at runtime, in English and Portuguese. The
 * language is the page's <html lang>; static prose lives in index.html and
 * index.pt.html. t('key', { name: value }) fills {name} placeholders.
 */
(function (root) {
  'use strict';

  const STRINGS = {
    en: {
      'common.play': 'Play',
      'common.pause': 'Pause',
      'common.run': 'Run',
      'common.paused': 'Paused.',

      'fm.clock': 't = {t} s of {total} s',
      'fm.running': 'Simulation running.',
      'fm.finished': 'Simulation finished. The full shot gather is shown on the right.',
      'fm.sourceMoved': 'Source moved. Press Play to run.',
      'fm.modelEdited': 'Model edited. Press Play to run.',
      'fm.loaded': 'Loaded the {name} model.',
      'fm.reset': 'Simulation reset.',

      'ml.xLabel': 'Starting velocity (m/s)',
      'ml.yLabel': 'Misfit (normalized)',
      'ml.aria': 'Misfit versus starting velocity for 4 Hz and 12 Hz data',
      'ml.traceX': 'Time (s)',
      'ml.traceY': 'Pressure (normalized)',
      'ml.traceAria': 'Observed and modeled trace at the receiver facing the middle source',
      'ml.true': 'true',
      'ml.guess': 'your guess',
      'ml.late': 'late',
      'ml.early': 'early',
      'ml.readout': 'Modeled arrival is {shift} ms {direction}. Half a period at {f} Hz is {half} ms, so this starting model is {verdict}',
      'ml.skipped': 'cycle-skipped: the nearest wiggle to match is the wrong one.',
      'ml.reach': 'within reach: the matching wiggle is the right one.',
      'ml.progress': 'Simulating… {pct}%',
      'ml.ready': 'Ready. Drag the slider to change the starting velocity.',

      'inv.xLabel': 'Iteration',
      'inv.yLabel': 'Misfit / starting misfit',
      'inv.aria': 'Misfit versus iteration',
      'inv.switch': 'switch to {f} Hz',
      'inv.progressZero': 'Iteration 0 of {max}',
      'inv.progress': 'Iteration {i} of {max} · {f} Hz · misfit at {pct}% of its starting value',
      'inv.finished': 'Finished {max} iterations.',
      'inv.pausedOne': 'Paused after one iteration.',
      'inv.computing': 'Computing gradient and line search… (shot {s} of {n})',
      'inv.simulating': 'Simulating observed data…',
      'inv.scenario': 'Scenario loaded. Press Run.',
      'inv.reset': 'Reset. Press Run to start again.',
      'inv.v0Changed': 'Starting model changed. Press Run.',
      'inv.bandChanged': 'Frequency band changed. Press Run.',
      'inv.geometryChanged': 'Acquisition geometry changed. Press Run.',

      'dl.true': 'True model',
      'dl.start': 'Starting model (for FWI)',
      'dl.fwi': 'Classical FWI',
      'dl.dl': 'Deep learning',
      'dl.missing': 'Comparison data not found. Run scripts/dl/compare.py.',
      'dl.fwiTime': '{time} ({n} iterations)',
      'dl.dlTime': '{time} (one forward pass)',
      'dl.minutes': '{n} minutes',

      'ls.classical': 'Classical FWI',
      'ls.model': 'Survey: network generates the model',
      'ls.data': 'Survey: network compares the data',
      'ls.prior': 'Survey: network acts as a prior',
      'ls.ml': 'Machine-learning-oriented work',
      'ls.legendSurvey': 'Deep-learning FWI survey',
      'ls.allTopics': 'All topics',
      'ls.aria': 'Timeline of the bibliography: one row per group, one dot per paper. The list below the chart contains the same papers.',
      'ls.count': 'Showing {shown} of {total} papers.',
      'ls.countTagged': 'Showing {shown} of {total} papers tagged {tags}.',
      'ls.or': ' or ',
      'ls.topics': 'Topics',
      'ls.openDoi': 'Open publication (doi:{doi})',
      'ls.openArxiv': 'Open on arXiv',
      'ls.unverified': 'Some bibliographic fields of this entry have not yet been checked against the publisher record.',
      'ls.etAl': 'et al.',
    },
    pt: {
      'common.play': 'Iniciar',
      'common.pause': 'Pausar',
      'common.run': 'Executar',
      'common.paused': 'Pausado.',

      'fm.clock': 't = {t} s de {total} s',
      'fm.running': 'Simulação em andamento.',
      'fm.finished': 'Simulação concluída. O sismograma completo aparece à direita.',
      'fm.sourceMoved': 'Fonte movida. Pressione Iniciar.',
      'fm.modelEdited': 'Modelo editado. Pressione Iniciar.',
      'fm.loaded': 'Modelo "{name}" carregado.',
      'fm.reset': 'Simulação reiniciada.',

      'ml.xLabel': 'Velocidade inicial (m/s)',
      'ml.yLabel': 'Misfit (normalizado)',
      'ml.aria': 'Misfit em função da velocidade inicial para dados de 4 Hz e 12 Hz',
      'ml.traceX': 'Tempo (s)',
      'ml.traceY': 'Pressão (normalizada)',
      'ml.traceAria': 'Traço observado e modelado no receptor em frente à fonte central',
      'ml.true': 'real',
      'ml.guess': 'seu chute',
      'ml.late': 'atrasada',
      'ml.early': 'adiantada',
      'ml.readout': 'A chegada modelada está {shift} ms {direction}. Meio período a {f} Hz são {half} ms, então este modelo inicial está {verdict}',
      'ml.skipped': 'em cycle-skipping: a oscilação mais próxima para alinhar é a errada.',
      'ml.reach': 'ao alcance: a oscilação a alinhar é a correta.',
      'ml.progress': 'Simulando… {pct}%',
      'ml.ready': 'Pronto. Arraste o controle para mudar a velocidade inicial.',

      'inv.xLabel': 'Iteração',
      'inv.yLabel': 'Misfit / misfit inicial',
      'inv.aria': 'Misfit em função da iteração',
      'inv.switch': 'troca para {f} Hz',
      'inv.progressZero': 'Iteração 0 de {max}',
      'inv.progress': 'Iteração {i} de {max} · {f} Hz · misfit em {pct}% do valor inicial',
      'inv.finished': '{max} iterações concluídas.',
      'inv.pausedOne': 'Pausado após uma iteração.',
      'inv.computing': 'Calculando o gradiente e a busca linear… (tiro {s} de {n})',
      'inv.simulating': 'Simulando os dados observados…',
      'inv.scenario': 'Cenário carregado. Pressione Executar.',
      'inv.reset': 'Reiniciado. Pressione Executar para começar de novo.',
      'inv.v0Changed': 'Modelo inicial alterado. Pressione Executar.',
      'inv.bandChanged': 'Banda de frequência alterada. Pressione Executar.',
      'inv.geometryChanged': 'Geometria de aquisição alterada. Pressione Executar.',

      'dl.true': 'Modelo real',
      'dl.start': 'Modelo inicial (do FWI)',
      'dl.fwi': 'FWI clássico',
      'dl.dl': 'Deep learning',
      'dl.missing': 'Dados da comparação não encontrados. Execute scripts/dl/compare.py.',
      'dl.fwiTime': '{time} ({n} iterações)',
      'dl.dlTime': '{time} (uma única passada)',
      'dl.minutes': '{n} minutos',

      'ls.classical': 'FWI clássico',
      'ls.model': 'Levantamento: a rede gera o modelo',
      'ls.data': 'Levantamento: a rede compara os dados',
      'ls.prior': 'Levantamento: a rede atua como prior',
      'ls.ml': 'Trabalhos orientados a machine learning',
      'ls.legendSurvey': 'Levantamento de FWI com deep learning',
      'ls.allTopics': 'Todos os temas',
      'ls.aria': 'Linha do tempo da bibliografia: uma faixa por grupo, um ponto por artigo. A lista abaixo do gráfico contém os mesmos artigos.',
      'ls.count': 'Mostrando {shown} de {total} artigos.',
      'ls.countTagged': 'Mostrando {shown} de {total} artigos com o tema {tags}.',
      'ls.or': ' ou ',
      'ls.topics': 'Temas',
      'ls.openDoi': 'Abrir publicação (doi:{doi})',
      'ls.openArxiv': 'Abrir no arXiv',
      'ls.unverified': 'Alguns campos bibliográficos desta entrada ainda não foram conferidos no registro da editora.',
      'ls.etAl': 'et al.',
    },
  };

  // Display names for the title-derived topic tags.
  const TAGS_PT = {
    multiparameter: 'multiparâmetro',
    crosstalk: 'crosstalk',
    'cycle-skipping': 'cycle-skipping',
    uncertainty: 'incerteza',
    'time-lapse': 'time-lapse (4D)',
    CNN: 'CNN',
    MLP: 'MLP',
    'neural representation': 'representação neural',
    'physics-informed': 'informado por física',
    'self-supervised': 'autossupervisionado',
    'learned prior': 'prior aprendido',
    'misfit function': 'função de misfit',
    reparameterization: 'reparametrização',
    'neural operator': 'operador neural',
    multiscale: 'multiescala',
    'optimal transport': 'transporte ótimo',
    benchmark: 'benchmark',
  };

  const lang = /^pt/i.test(document.documentElement.lang) ? 'pt' : 'en';
  const locale = lang === 'pt' ? 'pt-BR' : 'en-US';

  function t(key, vars) {
    const template = STRINGS[lang][key] !== undefined ? STRINGS[lang][key] : STRINGS.en[key];
    if (template === undefined) throw new Error('missing string: ' + key);
    return template.replace(/\{(\w+)\}/g, function (all, name) {
      return vars && vars[name] !== undefined ? String(vars[name]) : all;
    });
  }

  // Locale-aware fixed-digit number (decimal comma in Portuguese).
  function num(value, digits) {
    return Number(value).toLocaleString(locale, { minimumFractionDigits: digits || 0, maximumFractionDigits: digits || 0 });
  }

  function tag(name) {
    return lang === 'pt' && TAGS_PT[name] ? TAGS_PT[name] : name;
  }

  // Keep the reader's place when switching language: carry the #section over.
  document.querySelectorAll('[data-lang-switch] a').forEach(function (link) {
    link.addEventListener('click', function () {
      link.setAttribute('href', link.getAttribute('href').split('#')[0] + window.location.hash);
    });
  });

  root.FWI = root.FWI || {};
  root.FWI.i18n = { lang: lang, t: t, num: num, tag: tag, STRINGS: STRINGS };
})(globalThis);
