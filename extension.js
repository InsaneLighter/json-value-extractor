const vscode = require('vscode');

function activate(context) {
    let disposable = vscode.commands.registerCommand('extension.extractJsonValues', async function () {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('请打开一个 JSON 文件！');
            return;
        }

        // 检查文件类型：通过文件扩展名或语言ID
        const isJsonFile = editor.document.fileName.toLowerCase().endsWith('.json') || 
                          editor.document.languageId === 'json' ||
                          isValidJson(editor.document.getText());

        if (!isJsonFile) {
            vscode.window.showErrorMessage('当前文件不是有效的 JSON 文件！');
            return;
        }

        try {
            // 添加文件大小检查
            const fileSize = Buffer.byteLength(editor.document.getText(), 'utf8');
            const fileSizeMB = fileSize / (1024 * 1024);
            
            if (fileSizeMB > 5) { // 如果文件大于5MB，显示进度提示
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
    // 分块读取文件内容
    const documentText = editor.document.getText();
    const jsonContent = JSON.parse(documentText);

    // 获取字段名
    const fieldName = await vscode.window.showInputBox({
        prompt: '请输入要提取的字段名',
        placeHolder: '例如：name'
    });

    if (!fieldName) {
        return;
    }

    // 获取排序方式
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

    // 获取分隔符
    const separator = await vscode.window.showInputBox({
        prompt: '请输入分隔符',
        placeHolder: '默认为逗号(,)',
        value: ','
    });

    if (separator === undefined) {
        return;
    }

    // 使用 Map 存储值和出现次数
    const valueMap = new Map();
    
    // 优化的递归函数，使用迭代器处理大型数组
    async function* processChunk(obj) {
        if (Array.isArray(obj)) {
            const chunkSize = 1000; // 每次处理1000个元素
            for (let i = 0; i < obj.length; i += chunkSize) {
                const chunk = obj.slice(i, i + chunkSize);
                for (const item of chunk) {
                    yield* processChunk(item);
                }
                if (progress) {
                    progress.report({ increment: (i / obj.length) * 100 });
                }
                // 让出控制权，避免阻塞UI
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        } else if (obj && typeof obj === 'object') {
            for (const [key, value] of Object.entries(obj)) {
                if (key === fieldName) {
                    // 统计值的出现次数
                    valueMap.set(value, (valueMap.get(value) || 0) + 1);
                }
                yield* processChunk(value);
            }
        }
    }

    // 处理 JSON 内容
    for await (const _ of processChunk(jsonContent)) {
        // 迭代器处理中
    }

    // 处理排序
    let values = Array.from(valueMap.entries());
    if (sortOption.value === 'asc') {
        values.sort(([a], [b]) => String(a).localeCompare(String(b)));
    } else if (sortOption.value === 'desc') {
        values.sort(([a], [b]) => String(b).localeCompare(String(a)));
    }

    // 生成结果
    const resultLines = [
        '提取结果：',
        '-'.repeat(20),
        ...values.map(([value, count]) => `${value}${separator}出现 ${count} 次`)
    ];

    // 生成统计信息
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

    // 创建新文档显示结果
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