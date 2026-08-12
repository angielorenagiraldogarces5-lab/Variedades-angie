function formatearMoneda(valor) {
    var monto = Number(valor) || 0;
    var signo = monto < 0 ? '-' : '';
    monto = Math.abs(monto);
    var partes = monto.toFixed(2).split('.');
    var entero = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return signo + '$ ' + entero + ',' + partes[1];
}
