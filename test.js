const { google } = require('googleapis');
const path = require('path');

const SPREADSHEET_ID = '1zgf41qe7eIMj6jYKVoGZQB7J_mVcvRHXG7tIxvLSFEs';
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');

async function testConnection() {
  try {
    console.log('Autenticando com Service Account...');

    const auth = new google.auth.GoogleAuth({
      keyFile: CREDENTIALS_PATH,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });

    console.log('Autenticado com sucesso!\n');
    console.log('Buscando metadados da planilha...');

    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
    });

    const meta = spreadsheet.data;
    console.log(`Título: ${meta.properties.title}`);
    console.log(`Locale: ${meta.properties.locale}`);
    console.log(`Fuso horário: ${meta.properties.timeZone}\n`);

    const sheetNames = meta.sheets.map((s) => s.properties.title);
    console.log(`Total de abas: ${sheetNames.length}`);
    console.log('Abas encontradas:');
    sheetNames.forEach((name, i) => console.log(`  ${i + 1}. ${name}`));

    // Lê as primeiras 5 linhas da primeira aba para confirmar acesso aos dados
    const firstSheet = sheetNames[0];
    console.log(`\nLendo primeiras 5 linhas da aba "${firstSheet}"...`);

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${firstSheet}'!A1:Z5`,
    });

    const rows = response.data.values || [];
    if (rows.length === 0) {
      console.log('  (aba vazia ou sem dados nas primeiras 5 linhas)');
    } else {
      rows.forEach((row, i) => console.log(`  Linha ${i + 1}: ${row.join(' | ')}`));
    }

    console.log('\n✓ Conexão com a planilha funcionando corretamente!');
  } catch (err) {
    console.error('\n✗ Erro ao conectar com a planilha:');
    console.error(err.message);
    if (err.code === 403) {
      console.error('\nDica: Compartilhe a planilha com o e-mail da Service Account:');
      console.error('  planorocamentario@planoorcamentario.iam.gserviceaccount.com');
    }
    process.exit(1);
  }
}

testConnection();
