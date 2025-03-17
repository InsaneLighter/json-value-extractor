const vscode = require('vscode');

function activate(context) {
    let disposable = vscode.commands.registerCommand('extension.extractJsonValues', async function () {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('请打开一个 JSON 文件！');
            return;
        }

        if (!editor.document.fileName.toLowerCase().endsWith('.json')) {
            vscode.window.showErrorMessage('当前文件不是 JSON 文件！');
            return;
        }

        try {
            const fileSize = Buffer.byteLength(editor.document.getText(), 'utf8');
            const fileSizeMB = fileSize / (1024 * 1024);
            
            if (fileSizeMB > 5) {
                vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: "正在处理大文件...",
                    cancellable: true
                }, async (progress) => {
                    progress.report({ increment: 0 });
                    const result = await processJson(editor, progress);
                    progress.report({ increment: 100 });
                    return result;
                });
            } else {
                await processJson(editor);
            }
        } catch (error) {
            vscode.window.showErrorMessage('处理 JSON 时发生错误：' + error.message);
        }
    });

    context.subscriptions.push(disposable);
}

async function processJson(editor, progress = null) {
    const documentText = editor.document.getText();
    const jsonContent = JSON.parse(documentText);

    const fieldName = await vscode.window.showInputBox({
        prompt: '请输入要提取的字段名',
        placeHolder: '例如：name'
    });

    if (!fieldName) {
        return;
    }

    const sortOption = await vscode.window.showQuickPick([
        { label: '不排序', value: 'none' },
        { label: '升序排序', value: 'asc' },
        { label: '降序排序', value: 'desc' }
    ], {
        placeHolder: '请选择排序方式'
    });

    if (!sortOption) {
        return;
    }

    const separator = await vscode.window.showInputBox({
        prompt: '请输入分隔符',
        placeHolder: '默认为逗号(,)',
        value: ','
    });

    if (separator === undefined) {
        return;
    }

    const valueMap = new Map();
    
    async function* processChunk(obj) {
        if (Array.isArray(obj)) {
            const chunkSize = 1000;
            for (let i = 0; i < obj.length; i += chunkSize) {
                const chunk = obj.slice(i, i + chunkSize);
                for (const item of chunk) {
                    yield* processChunk(item);
                }
                if (progress) {
                    progress.report({ increment: (i / obj.length) * 100 });
                }
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        } else if (obj && typeof obj === 'object') {
            for (const [key, value] of Object.entries(obj)) {
                if (key === fieldName) {
                    valueMap.set(value, (valueMap.get(value) || 0) + 1);
                }
                yield* processChunk(value);
            }
        }
    }

    for await (const _ of processChunk(jsonContent)) {
        // 迭代器处理中
    }

    let values = Array.from(valueMap.entries());
    if (sortOption.value === 'asc') {
        values.sort(([a], [b]) => String(a).localeCompare(String(b)));
    } else if (sortOption.value === 'desc') {
        values.sort(([a], [b]) => String(b).localeCompare(String(a)));
    }

    const resultLines = [
        '提取结果：',
        '-'.repeat(20),
        ...values.map(([value, count]) => `${value}${separator}出现 ${count} 次`)
    ];

    const stats = {
        total: values.length,
        totalOccurrences: Array.from(valueMap.values()).reduce((a, b) => a + b, 0)
    };

    resultLines.push(
        '-'.repeat(20),
        `统计信息：`,
        `- 不同值的数量：${stats.total}`,
        `- 字段总出现次数：${stats.totalOccurrences}`,
        `- 所有值：${values.map(([v]) => v).join(separator)}`
    );

    const resultDocument = await vscode.workspace.openTextDocument({
        content: resultLines.join('\n'),
        language: 'text'
    });

    vscode.window.showTextDocument(resultDocument, {
        viewColumn: vscode.ViewColumn.Beside
    });
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};