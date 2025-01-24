// ==UserScript==
// @name         whmcs表单填充专家
// @namespace    http://tampermonkey.net/
// @version      1.01
// @description  高级表单自动填充解决方案
// @author       yumusb
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        GM_log
// @connect      api.deepseek.com
// ==/UserScript==

const DEBUG_MODE = false;
const MATCH_THRESHOLD = 0.6;
const EMAIL = 'some@gmail.com'; // 填写 邮箱(some@gmail.com)或者域名(xxxmail.com) ，如果是域名 则需要catch-all，会生成前缀后拼接到后面 xxx@xxxmail.com，如果是邮箱，则原模原样的填充。
// 能理解的 可以自己修改使用其他AI
const AI_API_KEY = 'xxxx'; // https://platform.deepseek.com/api_keys
const AI_ENDPOINT = `https://api.deepseek.com/v1/chat/completions`;
const AI_MODEL = `deepseek-chat`;

(function () {
    'use strict';

    let formStructure = null;
    let currentRetryHandler = null;

    // 添加全局样式
    const style = document.createElement('style');
    style.textContent = `
        .tm-loading {
            position: fixed !important;
            top: 50% !important;
            left: 50% !important;
            transform: translate(-50%, -50%) !important;
            background: rgba(0,0,0,0.8) !important;
            color: white !important;
            padding: 20px !important;
            border-radius: 8px !important;
            display: flex !important;
            align-items: center !important;
            gap: 10px !important;
            z-index: 100001 !important;
        }
        .tm-spinner {
            width: 20px !important;
            height: 20px !important;
            border: 3px solid #fff !important;
            border-radius: 50% !important;
            border-top-color: transparent !important;
            animation: tm-spin 1s linear infinite !important;
        }
        @keyframes tm-spin {
            to { transform: rotate(360deg); }
        }
        .tm-error {
            position: fixed !important;
            top: 20px !important;
            right: 20px !important;
            background: #ffebee !important;
            color: #b71c1c !important;
            padding: 16px !important;
            border-radius: 8px !important;
            box-shadow: 0 2px 4px rgba(0,0,0,0.2) !important;
            display: flex !important;
            align-items: center !important;
            gap: 10px !important;
            z-index: 100001 !important;
        }
    `;
    document.head.appendChild(style);
    // 调试系统
    function debugLog(level, ...args) {
        if (DEBUG_MODE) {
            const timestamp = new Date().toISOString().slice(11, 23);
            const message = [`[${timestamp}] [${level}]`, ...args].map(arg =>
                typeof arg === 'object' ? JSON.stringify(arg) : arg
            ).join(' ');
            console.log(message);
            GM_log(message);
        }
    }

    function handleError(context, error, retryHandler) {
        const errorMessage = `${context}: ${error.message}`;
        debugLog('ERROR', '🚨 错误详情:', errorMessage);
        hideLoading();
        showError(errorMessage, retryHandler);
    }

    // 新增加载提示功能
    function showLoading() {
        const loading = document.createElement('div');
        loading.className = 'tm-loading';
        loading.innerHTML = `
            <div class="tm-spinner"></div>
            加载中，请稍候...
        `;
        loading.id = 'tm-loading';
        document.body.appendChild(loading);
    }

    function hideLoading() {
        const loading = document.getElementById('tm-loading');
        if (loading) loading.remove();
    }

    // 新增错误提示功能
    function showError(message, retryHandler) {
        const existingError = document.querySelector('.tm-error');
        if (existingError) existingError.remove();

        const errorDiv = document.createElement('div');
        errorDiv.className = 'tm-error';
        errorDiv.innerHTML = `
            <span>${message}</span>
            <button id="tm-retry" style="padding: 4px 8px; background: #d32f2f; color: white;
                border: none; border-radius: 4px; cursor: pointer;">重试</button>
        `;

        if (retryHandler) {
            errorDiv.querySelector('#tm-retry').addEventListener('click', () => {
                errorDiv.remove();
                retryHandler();
            });
        }
        document.body.appendChild(errorDiv);
    }
    function init() {
        try {
            if (detectForm()) {
                createUI();
                debugLog('INFO', '💡 系统初始化完成');
            }
        } catch (e) {
            handleError('初始化失败', e);
        }
    }

    // 表单检测
    function detectForm() {
        const whmcsForm = document.getElementById('containerNewUserSignup');
        const inputs = document.querySelectorAll('input, select, textarea');

        debugLog('INFO', '🔍 表单检测结果:', {
            whmcsDetected: !!whmcsForm,
            inputCount: inputs.length
        });

        return whmcsForm && inputs.length > 3;
    }

    // 创建界面
function createUI() {
    const button = document.createElement('button');
    button.innerHTML = '🪄 智能填充';
    Object.assign(button.style, {
        position: 'fixed',
        left: '20px',  // Change this to 'left'
        top: '20px',   // Change this to 'top'
        zIndex: 99999,
        padding: '12px 24px',
        background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
        color: 'white',
        border: 'none',
        borderRadius: '8px',
        cursor: 'pointer',
        boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
    });
    button.addEventListener('click', showConfigDialog);
    document.body.appendChild(button);
}



    function showConfigDialog() {
        const dialog = document.createElement('div');
        dialog.innerHTML = `
        <div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
            background:#fff;padding:24px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,0.2);
            min-width:320px;z-index:100000;">
            <h3 style="margin:0 0 16px 0;color:#1f2937;">智能填充设置</h3>
            <div style="margin-bottom:20px;">
                <label style="display:block;margin-bottom:8px;color:#4b5563;">选择国家</label>
                <!-- 新增输入框（复用原有样式） -->
                <input
                    type="text"
                    id="searchInput"
                    placeholder="输入筛选"
                    style="margin-bottom:8px;${document.getElementById('countrySelect')?.style.cssText || ''}">
                <select id="countrySelect" style="width:100%;padding:8px 12px;border:1px solid #e5e7eb;
                    border-radius:6px;background:#f9fafb;"></select>
            </div>
            <div style="display:flex;gap:12px;justify-content:flex-end;">
                <button id="confirmBtn" style="padding:8px 16px;background:#3b82f6;color:white;
                    border:none;border-radius:4px;cursor:pointer;">开始填充</button>
                <button id="cancelBtn" style="padding:8px 16px;background:#6b7280;color:white;
                    border:none;border-radius:4px;cursor:pointer;">取消</button>
            </div>
        </div>
    `;

        // 动态填充国家选项
        const countrySelect = dialog.querySelector('#countrySelect');
        const existingCountry = document.querySelector('select[name="country"][id="inputCountry"]');
        let allCountries = []; // 存储完整国家列表

        // 填充选项函数
        const populateCountries = (filteredList) => {
            countrySelect.innerHTML = '';
            filteredList.forEach(item => {
                const option = new Option(item.text, item.value);
                countrySelect.add(option);
            });

        };

        if (existingCountry) {
            // 从现有选择器获取数据
            allCountries = Array.from(existingCountry.options).map(option => ({
                value: option.value,
                text: option.textContent
            }));
        } else {
            // 默认备用选项
            allCountries = ['US', 'CN', 'JP', 'DE'].map(code => ({
                value: code,
                text: code
            }));
        }

        // 初始填充
        populateCountries(allCountries);
        if (existingCountry){
            countrySelect.value = existingCountry.value;
        }


        // 添加输入筛选功能
        const searchInput = dialog.querySelector('#searchInput');
        searchInput.addEventListener('input', function (e) {
            const searchTerm = e.target.value.trim().toLowerCase();
            const filtered = allCountries.filter(item =>
                item.text.toLowerCase().includes(searchTerm)
            );
            populateCountries(filtered);
        });

        document.body.appendChild(dialog);
        setupDialogEvents(dialog);
    }


    function setupDialogEvents(dialog) {
        dialog.querySelector('#cancelBtn').addEventListener('click', () => dialog.remove());

        dialog.querySelector('#confirmBtn').addEventListener('click', async () => {
            try {
                dialog.remove();
                const country = `${dialog.querySelector('#countrySelect').querySelector('option:checked').text}[${dialog.querySelector('#countrySelect').value}]`;

                currentRetryHandler = async () => {
                    showLoading();
                    try {
                        formStructure = analyzeForm();
                        const aiData = await generateAIData(country);
                        document.querySelector('select[name="country"][id="inputCountry"]').value = dialog.querySelector('#countrySelect').value;
                        intelligentFill(aiData);
                    } catch (e) {
                        handleError('重试失败', e, currentRetryHandler);
                    } finally {
                        hideLoading();
                    }
                };

                currentRetryHandler();
            } catch (e) {
                handleError('初始化失败', e, currentRetryHandler);
            }
        });
    }

    // 表单分析
    function analyzeForm() {
        // 仅选择 id 包含 "newusersignup" 的 <div> 元素
        const divelements = Array.from(document.querySelectorAll('div[id]'));

        // 使用正则表达式实现不区分大小写的匹配
        const container = divelements.find(element =>
            /newusersignup/i.test(element.id)
        );

        // 检查是否找到符合条件的容器
        if (!container) {
            debugLog('⚠️ 未找到符合条件的表单容器');
            return null;
        }

        debugLog('✅ 成功找到符合条件的表单容器:', container);

        // 获取容器内的表单字段
        const elements = container.querySelectorAll('input, select, textarea');
        const structure = {
            fields: {},
            elements: []
        };

        elements.forEach((el, index) => {
            if (el.placeholder && el.placeholder.includes('Optional')) {
                return;
            }
            const identifier = [
                el.id,
                el.name,
                el.placeholder,
                el.getAttribute('data-field'),
                `field_${index}`
            ].find(v => v && v.trim());

            const fieldInfo = {
                element: el,
                identifier: identifier,
                type: el.type || el.tagName.toLowerCase(),
                attributes: {
                    id: el.id,
                    name: el.name,
                    placeholder: el.placeholder,
                    'data-field': el.getAttribute('data-field')
                }
            };
            structure.fields[identifier] = fieldInfo;
            structure.elements.push(fieldInfo);
        });

        debugLog('INFO', '📋 表单分析结果:', structure);
        return structure;
    }


    // GM_xmlhttpRequest Promise 封装
    function GM_fetch(options) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                ...options,
                onload: response => resolve(response),
                onerror: error => reject(error)
            });
        });
    }

    // AI数据生成
    async function generateAIData(country) {
        const prompt = buildPrompt(country);
        debugLog('INFO', '📋 AI提示词:', prompt);
        showLoading();
        try {
            const response = await GM_fetch({
                method: 'POST',
                url: AI_ENDPOINT,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${AI_API_KEY}`
                },
                data: JSON.stringify({
                    model: AI_MODEL,
                    messages: [{
                        role: 'user',
                        content: prompt
                    }],
                    temperature: 0.7
                }),
                timeout: 15000
            });


            const data = parseAIResponse(response.responseText);
            return data;
        } finally {
            hideLoading();
        }
    }

    // 构建提示词
    function buildPrompt(country) {
        const fieldList = Object.values(formStructure.fields).map(f =>
            `"${f.identifier}" (类型: ${f.type})`
        ).join('\n');

        return `

作为数据生成专家，请为'${country}'用户创建符合以下字段要求的测试数据：

需要填充的字段：
${fieldList}

要求：
1. 生成符合'${country}'国家规范的合理数据，严格遵守当地格式和标准。
2. 电话号码必须使用当地的国家代码和格式（例如：中国：+86 138XXXX8888，美国：+1 123-456-7890，英国：+44 7711 123456），不能生成常见的无效或虚假的号码。
3. 邮编（如果适用）必须符合当地的格式（例如：中国：6位数字，美国：5位数字，英国：格式为SW1A 1AA）。
4. 电子邮箱的前缀必须是纯字母和数字组合，域名固定为zhanweifu.com，例如：zhangsan@zhanweifu.com。
5. 地址字段使用常见的城市、街道等描述，避免使用“测试地址”或不真实的地名。使用英文描述。
6. 姓名字段使用拼音或英文形式（例如：中国：Xiaoming Wang，美国：John Smith，英国：Sarah Johnson）。
7. 确保所有必填字段完整填写，不得有空值或不合适的数据，非必填字段可以留空。
8. 数据必须严格符合JSON格式，仅返回数据，不得有其他说明或注释。

示例：
{
  "姓名": "Xiaoming Wang",
  "电话号码": "+86 13888888888",
  "电子邮箱": "xiaoming123@zhanweifu.com",
  "地址": "No. 123, Chaoyang District, Beijing",
  "邮编": "100000"
}
`;

    }

    // 解析AI响应
    function parseAIResponse(responseText) {
        debugLog('ERROR', `来自AI的响应是=>${responseText}`);
        try {
            const response = JSON.parse(responseText);
            const content = response.choices[0].message.content;
            const cleanContent = content.replace(/```json/g, '').replace(/```/g, '');
            return JSON.parse(cleanContent);
        } catch (e) {
            //debugLog('ERROR', `来自AI的响应是=>${responseText}`);
            throw new Error('AI响应解析失败: ' + e.message);
        }
    }

    // 智能填充
    function intelligentFill(aiData) {
        try {

            let successCount = 0;
            const report = [];

            Object.entries(aiData).forEach(([fieldKey, value]) => {
                const matchResult = findBestMatch(fieldKey);
                report.push(matchResult);
                if (matchResult.score >= MATCH_THRESHOLD) {
                    if(value.indexOf("zhanweifu.com")!=-1){
                        if (EMAIL.indexOf("@")!=-1){
                            value = EMAIL;
                        }else{
                            value = value.replace(/zhanweifu\.com/g, EMAIL);
                        }
                    }
                    value = value.replace(/zhanweifu\.com/g, EMAIL);
                    fillField(matchResult.element, value);
                    successCount++;
                    debugLog('INFO', `✅ 成功填充字段: ${fieldKey} → ${matchResult.identifier}`);
                } else {
                    debugLog('WARNING', `⚠️ 未匹配字段: ${fieldKey} (最高相似度 ${matchResult.score})`);
                }
            });
            showFillReport(successCount, report);
        } catch (e) {
            handleError('填充失败', e, currentRetryHandler);
        }
    }

    // 字段匹配算法
    function findBestMatch(targetKey) {
        let bestMatch = null;
        let maxScore = 0;

        formStructure.elements.forEach(field => {
            const score = calculateSimilarity(targetKey, field.identifier);
            if (score > maxScore) {
                maxScore = score;
                bestMatch = field;
            }
        });

        return {
            targetKey,
            identifier: bestMatch?.identifier,
            element: bestMatch?.element,
            score: maxScore,
            possibleMatches: formStructure.elements
                .map(f => ({ id: f.identifier, score: calculateSimilarity(targetKey, f.identifier) }))
                .sort((a, b) => b.score - a.score)
        };
    }
    // 相似度计算
    function calculateSimilarity(a, b) {
        const normalize = str => str.toLowerCase().replace(/[^a-z0-9]/g, '');
        const str1 = normalize(a);
        const str2 = normalize(b);

        // 使用Jaccard相似度算法
        const set1 = new Set(str1.split(''));
        const set2 = new Set(str2.split(''));
        const intersection = new Set([...set1].filter(c => set2.has(c)));
        return intersection.size / (set1.size + set2.size - intersection.size);
    }

    // 字段填充
    function fillField(element, value) {
        try {
            switch (element.type) {
                case 'select-one':
                    var option = [...element.options].find(opt =>
                        opt.text.includes(value) || opt.value === value
                    );
                    if (option) element.value = option.value;
                    break;
                case 'checkbox':
                case 'radio':
                    element.checked = true;
                    break;
                default:
                    element.value = value;
            }
            element.dispatchEvent(new Event('change', { bubbles: true }));
        } catch (e) {
            throw new Error(`字段填充失败: ${element.identifier}`);
        }
    }

    // 结果报告
    function showFillReport(successCount, report) {
        debugLog('📊 填充统计:', {
            total: Object.keys(report).length,
            success: successCount,
            failure: Object.keys(report).length - successCount
        });

        GM_notification({
            title: `填充完成 (${successCount}成功)`,
            text: `查看控制台获取详细信息`,
            timeout: 3000
        });
    }

    // 启动脚本
    window.addEventListener('load', init);
})();
