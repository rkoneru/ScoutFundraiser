const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const server = http.createServer((req, res) => {
    let urlPath = req.url.split('?')[0];
    if (urlPath === '/') {
        urlPath = '/index.html';
    }

    let filePath = path.join(__dirname, urlPath);

    fs.readFile(filePath, (err, data) => {
        if (err) {
            console.error(`404 - File not found: ${filePath} (requested: ${req.url})`);
            res.writeHead(404, { 'Content-Type': 'text/html' });
            res.end('<h1>404 Not Found</h1>');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        let contentType = 'text/html';
        if (ext === '.css') contentType = 'text/css';
        else if (ext === '.js') contentType = 'text/javascript';
        else if (ext === '.json') contentType = 'application/json';
        else if (ext === '.png') contentType = 'image/png';
        else if (ext === '.svg') contentType = 'image/svg+xml';
        else if (ext === '.woff2') contentType = 'font/woff2';
        else if (ext === '.gif') contentType = 'image/gif';
        else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
        else if (ext === '.ico') contentType = 'image/x-icon';

        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
});

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`Serving files from: ${__dirname}`);
});
