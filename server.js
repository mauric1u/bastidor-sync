// server.js - Sistema Semi-Manual Shopify-WhatsApp
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// Configurações (vais substituir pelos teus dados)
const SHOPIFY_CONFIG = {
    shop: 'bastidor-colorido-2-0',
    accessToken: process.env.SHOPIFY_TOKEN, // O token que obtiveste
    apiVersion: '2023-10'
};

// Base de dados em memória
let products = [];
let lastSync = null;

// Função para buscar produtos do Shopify
async function getShopifyProducts() {
    try {
        console.log('🔄 Buscando produtos do Shopify...');
        
        const response = await axios.get(
            `https://${SHOPIFY_CONFIG.shop}.myshopify.com/admin/api/${SHOPIFY_CONFIG.apiVersion}/products.json?limit=250`,
            {
                headers: {
                    'X-Shopify-Access-Token': SHOPIFY_CONFIG.accessToken
                }
            }
        );
        
        console.log(`✅ ${response.data.products.length} produtos encontrados`);
        return response.data.products;
    } catch (error) {
        console.error('❌ Erro ao buscar produtos:', error.response?.data || error.message);
        return [];
    }
}

// Função para formatar produtos para WhatsApp Business
function formatProductsForWhatsApp(shopifyProducts) {
    return shopifyProducts.map(product => {
        const variant = product.variants[0] || {};
        const image = product.images[0]?.src || '';
        
        return {
            id: product.id,
            name: product.title,
            description: cleanDescription(product.body_html),
            price: `€${parseFloat(variant.price || 0).toFixed(2)}`,
            currency: 'EUR',
            image_url: image,
            availability: variant.inventory_quantity > 0 ? 'Em stock' : 'Sem stock',
            stock: variant.inventory_quantity || 0,
            sku: variant.sku || '',
            category: product.product_type || 'Geral',
            vendor: product.vendor || 'Bastidor Colorido',
            tags: product.tags || '',
            url: `https://bastidorcolorido.pt/products/${product.handle}`
        };
    });
}

// Limpar descrição HTML
function cleanDescription(html) {
    if (!html) return '';
    return html
        .replace(/<[^>]*>/g, '') // Remove HTML tags
        .replace(/&nbsp;/g, ' ') // Remove &nbsp;
        .replace(/\s+/g, ' ') // Remove espaços duplos
        .trim()
        .substring(0, 300); // Limite WhatsApp
}

// Gerar CSV para importação
function generateCSV(formattedProducts) {
    const headers = [
        'ID', 'Nome', 'Descrição', 'Preço', 'Moeda', 'Imagem', 
        'Disponibilidade', 'Stock', 'SKU', 'Categoria', 'Marca', 'Tags', 'URL'
    ];
    
    let csv = headers.join(',') + '\n';
    
    formattedProducts.forEach(product => {
        const row = [
            product.id,
            `"${product.name}"`,
            `"${product.description}"`,
            product.price,
            product.currency,
            product.image_url,
            product.availability,
            product.stock,
            product.sku,
            product.category,
            product.vendor,
            `"${product.tags}"`,
            product.url
        ];
        csv += row.join(',') + '\n';
    });
    
    return csv;
}

// Gerar JSON para WhatsApp Business App
function generateWhatsAppJSON(formattedProducts) {
    return {
        catalog_name: "Bastidor Colorido - Catálogo",
        products: formattedProducts.map(product => ({
            retailer_id: product.id.toString(),
            name: product.name,
            description: product.description,
            price: Math.round(parseFloat(product.price.replace('€', '')) * 100), // Cêntimos
            currency: 'EUR',
            image_url: product.image_url,
            availability: product.stock > 0 ? 'in stock' : 'out of stock',
            condition: 'new',
            brand: product.vendor,
            category: product.category,
            url: product.url
        }))
    };
}

// Sincronização principal
async function syncProducts() {
    console.log('🔄 Iniciando sincronização...');
    
    const shopifyProducts = await getShopifyProducts();
    if (shopifyProducts.length === 0) {
        return { success: false, error: 'Nenhum produto encontrado' };
    }
    
    // Formatar produtos
    const formattedProducts = formatProductsForWhatsApp(shopifyProducts);
    
    // Guardar em memória
    products = formattedProducts;
    lastSync = new Date();
    
    // Gerar ficheiros para download
    const csv = generateCSV(formattedProducts);
    const json = generateWhatsAppJSON(formattedProducts);
    
    // Guardar ficheiros
    const publicDir = path.join(__dirname, 'public');
    if (!fs.existsSync(publicDir)) {
        fs.mkdirSync(publicDir);
    }
    
    fs.writeFileSync(path.join(publicDir, 'catalogo.csv'), csv);
    fs.writeFileSync(path.join(publicDir, 'catalogo.json'), JSON.stringify(json, null, 2));
    fs.writeFileSync(path.join(publicDir, 'produtos.json'), JSON.stringify(formattedProducts, null, 2));
    
    console.log('✅ Sincronização concluída!');
    return { 
        success: true, 
        count: formattedProducts.length,
        files: ['catalogo.csv', 'catalogo.json', 'produtos.json']
    };
}

// Rotas API
app.post('/api/sync', async (req, res) => {
    console.log('📢 Sincronização manual iniciada');
    const result = await syncProducts();
    res.json(result);
});

app.get('/api/status', (req, res) => {
    res.json({
        products_count: products.length,
        last_sync: lastSync,
        shopify_connected: !!SHOPIFY_CONFIG.accessToken
    });
});

app.get('/api/products', (req, res) => {
    res.json({
        products: products.slice(0, 50), // Primeiros 50 para preview
        total: products.length,
        last_sync: lastSync
    });
});

// Dashboard HTML
app.get('/', (req, res) => {
    const html = `
    <!DOCTYPE html>
    <html lang="pt">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Bastidor Colorido - Sistema de Sincronização</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
                padding: 20px;
            }
            .container { 
                max-width: 1200px; 
                margin: 0 auto; 
                background: white; 
                border-radius: 20px; 
                box-shadow: 0 20px 40px rgba(0,0,0,0.1);
                overflow: hidden;
            }
            .header { 
                background: linear-gradient(135deg, #ff6b6b, #ee5a24);
                color: white; 
                padding: 40px 30px; 
                text-align: center; 
            }
            .header h1 { font-size: 2.5em; margin-bottom: 10px; }
            .header p { font-size: 1.2em; opacity: 0.9; }
            
            .content { padding: 40px 30px; }
            
            .stats { 
                display: grid; 
                grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); 
                gap: 25px; 
                margin-bottom: 40px; 
            }
            .stat-card { 
                background: linear-gradient(135deg, #74b9ff, #0984e3);
                color: white; 
                padding: 30px; 
                border-radius: 15px; 
                text-align: center; 
                box-shadow: 0 10px 20px rgba(0,0,0,0.1);
                transition: transform 0.3s ease;
            }
            .stat-card:hover { transform: translateY(-5px); }
            .stat-number { font-size: 3em; font-weight: bold; margin-bottom: 10px; }
            .stat-label { font-size: 1.1em; opacity: 0.9; }
            
            .actions { 
                background: #f8f9fa; 
                padding: 30px; 
                border-radius: 15px; 
                margin: 30px 0; 
                text-align: center; 
            }
            .btn { 
                background: linear-gradient(135deg, #00b894, #00a085);
                color: white; 
                padding: 15px 30px; 
                border: none; 
                border-radius: 50px; 
                font-size: 1.1em; 
                cursor: pointer; 
                margin: 10px; 
                transition: all 0.3s ease;
                box-shadow: 0 5px 15px rgba(0,0,0,0.2);
            }
            .btn:hover { 
                transform: translateY(-2px); 
                box-shadow: 0 8px 25px rgba(0,0,0,0.3);
            }
            .btn:disabled { 
                background: #ccc; 
                cursor: not-allowed; 
                transform: none;
            }
            
            .download-section {
                background: #e8f4fd;
                padding: 30px;
                border-radius: 15px;
                margin: 30px 0;
            }
            .download-section h3 {
                color: #2d3436;
                margin-bottom: 20px;
                font-size: 1.5em;
            }
            .download-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
                gap: 20px;
            }
            .download-card {
                background: white;
                padding: 25px;
                border-radius: 10px;
                box-shadow: 0 5px 15px rgba(0,0,0,0.1);
            }
            .download-card h4 {
                color: #2d3436;
                margin-bottom: 15px;
                font-size: 1.2em;
            }
            .download-card p {
                color: #636e72;
                margin-bottom: 15px;
                line-height: 1.5;
            }
            .download-btn {
                background: linear-gradient(135deg, #a29bfe, #6c5ce7);
                color: white;
                text-decoration: none;
                padding: 12px 25px;
                border-radius: 25px;
                display: inline-block;
                transition: all 0.3s ease;
            }
            .download-btn:hover {
                transform: translateY(-2px);
                text-decoration: none;
                color: white;
            }
            
            .instructions {
                background: #fff3cd;
                border: 1px solid #ffeaa7;
                padding: 25px;
                border-radius: 10px;
                margin: 30px 0;
            }
            .instructions h3 {
                color: #e17055;
                margin-bottom: 15px;
            }
            .instructions ol {
                color: #2d3436;
                padding-left: 20px;
                line-height: 1.8;
            }
            .instructions li {
                margin-bottom: 8px;
            }
            
            .products-preview {
                margin-top: 30px;
            }
            .product-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
                gap: 20px;
                margin-top: 20px;
            }
            .product-card {
                border: 1px solid #ddd;
                border-radius: 10px;
                overflow: hidden;
                background: white;
                transition: transform 0.3s ease;
            }
            .product-card:hover {
                transform: translateY(-5px);
                box-shadow: 0 10px 25px rgba(0,0,0,0.1);
            }
            .product-image {
                width: 100%;
                height: 200px;
                object-fit: cover;
            }
            .product-info {
                padding: 20px;
            }
            .product-name {
                font-weight: bold;
                color: #2d3436;
                margin-bottom: 10px;
                font-size: 1.1em;
            }
            .product-price {
                color: #00b894;
                font-size: 1.3em;
                font-weight: bold;
                margin-bottom: 5px;
            }
            .product-stock {
                color: #636e72;
                font-size: 0.9em;
            }
            
            .loading {
                display: none;
                text-align: center;
                padding: 20px;
                color: #666;
            }
            
            .status-indicator {
                display: inline-block;
                width: 12px;
                height: 12px;
                border-radius: 50%;
                margin-right: 8px;
            }
            .status-online { background: #00b894; }
            .status-offline { background: #e17055; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🛍️ Bastidor Colorido</h1>
                <p>Sistema de Sincronização Shopify → WhatsApp</p>
            </div>
            
            <div class="content">
                <div class="stats" id="stats">
                    <div class="stat-card">
                        <div class="stat-number" id="product-count">-</div>
                        <div class="stat-label">Produtos Sincronizados</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number" id="sync-status">
                            <span class="status-indicator status-offline"></span>
                            Offline
                        </div>
                        <div class="stat-label">Status da Ligação</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number" id="last-sync">Nunca</div>
                        <div class="stat-label">Última Sincronização</div>
                    </div>
                </div>
                
                <div class="actions">
                    <h3 style="margin-bottom: 20px; color: #2d3436;">Ações Disponíveis</h3>
                    <button class="btn" onclick="syncNow()" id="sync-btn">
                        🔄 Sincronizar Agora
                    </button>
                    <button class="btn" onclick="loadProducts()">
                        👁️ Ver Produtos
                    </button>
                    <button class="btn" onclick="refreshStatus()">
                        📊 Atualizar Estado
                    </button>
                </div>
                
                <div class="loading" id="loading">
                    <p>🔄 A sincronizar produtos... Aguarde...</p>
                </div>
                
                <div class="download-section" id="download-section" style="display: none;">
                    <h3>📥 Ficheiros Prontos para Download</h3>
                    <p style="margin-bottom: 20px; color: #636e72;">
                        Depois de sincronizar, podes fazer download dos ficheiros formatados para importar no WhatsApp Business:
                    </p>
                    <div class="download-grid">
                        <div class="download-card">
                            <h4>📊 Ficheiro CSV</h4>
                            <p>Formato tabela para importação direta no WhatsApp Business ou Excel. Ideal para edição manual.</p>
                            <a href="/catalogo.csv" class="download-btn" download>⬇️ Download CSV</a>
                        </div>
                        <div class="download-card">
                            <h4>📱 Ficheiro JSON</h4>
                            <p>Formato estruturado para WhatsApp Business API. Contém todos os dados formatados.</p>
                            <a href="/catalogo.json" class="download-btn" download>⬇️ Download JSON</a>
                        </div>
                        <div class="download-card">
                            <h4>🛍️ Lista Produtos</h4>
                            <p>Lista completa e legível de todos os produtos com detalhes. Ideal para revisão.</p>
                            <a href="/produtos.json" class="download-btn" download>⬇️ Download Lista</a>
                        </div>
                    </div>
                </div>
                
                <div class="instructions">
                    <h3>📖 Como Usar no WhatsApp Business</h3>
                    <ol>
                        <li>Clica em <strong>"🔄 Sincronizar Agora"</strong> para buscar produtos atualizados do Shopify</li>
                        <li>Faz download do <strong>ficheiro CSV</strong> após a sincronização</li>
                        <li>Abre a app <strong>WhatsApp Business</strong> no telemóvel</li>
                        <li>Vai a <strong>Mais → Catálogo → Importar produtos</strong></li>
                        <li>Seleciona o ficheiro CSV descarregado</li>
                        <li>Confirma a importação - os produtos aparecem automaticamente!</li>
                        <li><strong>Para atualizações:</strong> Repete o processo sempre que mudares preços ou stock</li>
                    </ol>
                </div>
                
                <div class="products-preview">
                    <h3 style="color: #2d3436; margin-bottom: 20px;">🛍️ Pré-visualização dos Produtos</h3>
                    <div class="product-grid" id="products-grid">
                        <p style="text-align: center; color: #636e72; grid-column: 1 / -1;">
                            Clica em "Sincronizar Agora" para ver os produtos
                        </p>
                    </div>
                </div>
            </div>
        </div>
        
        <script>
            // Atualizar estado
            async function refreshStatus() {
                try {
                    const response = await fetch('/api/status');
                    const data = await response.json();
                    
                    document.getElementById('product-count').textContent = data.products_count || 0;
                    
                    const statusEl = document.getElementById('sync-status');
                    if (data.shopify_connected) {
                        statusEl.innerHTML = '<span class="status-indicator status-online"></span>Online';
                    } else {
                        statusEl.innerHTML = '<span class="status-indicator status-offline"></span>Offline';
                    }
                    
                    if (data.last_sync) {
                        const date = new Date(data.last_sync);
                        document.getElementById('last-sync').textContent = date.toLocaleString('pt-PT');
                    }
                    
                    if (data.products_count > 0) {
                        document.getElementById('download-section').style.display = 'block';
                    }
                } catch (error) {
                    console.error('Erro ao atualizar estado:', error);
                }
            }
            
            // Sincronizar
            async function syncNow() {
                const btn = document.getElementById('sync-btn');
                const loading = document.getElementById('loading');
                
                btn.disabled = true;
                btn.textContent = '⏳ A sincronizar...';
                loading.style.display = 'block';
                
                try {
                    const response = await fetch('/api/sync', { method: 'POST' });
                    const result = await response.json();
                    
                    if (result.success) {
                        alert(\`✅ Sincronização concluída!\\n\\n\${result.count} produtos sincronizados.\\n\\nFicheiros prontos para download.\`);
                        refreshStatus();
                        loadProducts();
                        document.getElementById('download-section').style.display = 'block';
                    } else {
                        alert(\`❌ Erro na sincronização:\\n\${result.error}\`);
                    }
                } catch (error) {
                    alert(\`❌ Erro de ligação:\\n\${error.message}\`);
                } finally {
                    btn.disabled = false;
                    btn.textContent = '🔄 Sincronizar Agora';
                    loading.style.display = 'none';
                }
            }
            
            // Carregar produtos
            async function loadProducts() {
                try {
                    const response = await fetch('/api/products');
                    const data = await response.json();
                    
                    const grid = document.getElementById('products-grid');
                    
                    if (data.products && data.products.length > 0) {
                        grid.innerHTML = data.products.map(product => \`
                            <div class="product-card">
                                \${product.image_url ? \`<img src="\${product.image_url}" alt="\${product.name}" class="product-image">\` : ''}
                                <div class="product-info">
                                    <div class="product-name">\${product.name}</div>
                                    <div class="product-price">\${product.price}</div>
                                    <div class="product-stock">\${product.availability} (\${product.stock} unidades)</div>
                                </div>
                            </div>
                        \`).join('');
                    } else {
                        grid.innerHTML = '<p style="text-align: center; color: #636e72; grid-column: 1 / -1;">Nenhum produto encontrado. Clica em "Sincronizar Agora".</p>';
                    }
                } catch (error) {
                    console.error('Erro ao carregar produtos:', error);
                }
            }
            
            // Carregar ao iniciar
            window.onload = function() {
                refreshStatus();
                loadProducts();
            };
        </script>
    </body>
    </html>
    `;
    res.send(html);
});

// Webhook Shopify (para atualizações automáticas)
app.post('/webhook/shopify/products', (req, res) => {
    console.log('📢 Produto atualizado no Shopify:', req.body.title || 'Produto');
    
    // Agendar sincronização em 5 minutos
    setTimeout(() => {
        syncProducts();
    }, 5 * 60 * 1000);
    
    res.status(200).send('OK');
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Sistema iniciado na porta ${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}`);
    console.log(`💡 Substitui o token Shopify no código e depois testa!`);
});


module.exports = app;

