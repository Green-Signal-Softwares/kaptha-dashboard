const { google } = require('googleapis');
const path = require('path');

const SPREADSHEET_ID = '1zgf41qe7eIMj6jYKVoGZQB7J_mVcvRHXG7tIxvLSFEs';

async function explore() {
  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(__dirname, 'credentials.json'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const authClient = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: authClient });

  // Lê toda a aba DRE GERENCIAL
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "'DRE GERENCIAL'!A1:AH200",
  });

  const rows = res.data.values || [];
  console.log(`Total de linhas retornadas: ${rows.length}\n`);

  // Mostra linhas 1-10 (cabeçalho + primeiras linhas)
  console.log('=== LINHAS 1-10 (cabeçalho) ===');
  rows.slice(0, 10).forEach((row, i) => {
    console.log(`Linha ${i + 1}: [${row.slice(0, 20).join(' | ')}]`);
  });

  // Mostra linhas específicas mencionadas no briefing
  const linhasChave = [3, 4, 5, 6, 7, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 120, 121, 122, 123];
  console.log('\n=== LINHAS-CHAVE DO DRE ===');
  linhasChave.forEach(n => {
    const row = rows[n - 1];
    if (row) {
      console.log(`Linha ${n}: [${row.slice(0, 18).join(' | ')}]`);
    } else {
      console.log(`Linha ${n}: (vazia/não existe)`);
    }
  });

  // Mostra todas as linhas com conteúdo na coluna A (indicadores)
  console.log('\n=== COLUNA A (todos os indicadores) ===');
  rows.forEach((row, i) => {
    if (row[0] && row[0].trim()) {
      console.log(`Linha ${i + 1}: "${row[0]}" | Exemplo valor col B: "${row[1] || ''}" | Col C: "${row[2] || ''}"`);
    }
  });

  // Mostra o cabeçalho completo (linha 2 - meses)
  const header = rows[1] || [];
  console.log('\n=== CABEÇALHO COMPLETO (linha 2 - meses) ===');
  header.forEach((cell, i) => {
    if (cell && cell.trim()) {
      const col = String.fromCharCode(65 + i);
      console.log(`  Coluna ${i < 26 ? col : 'A' + String.fromCharCode(65 + (i - 26))} (índice ${i}): "${cell}"`);
    }
  });
}

explore().catch(err => {
  console.error('Erro:', err.message);
  process.exit(1);
});
