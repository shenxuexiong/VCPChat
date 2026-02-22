// modules/upstreamErrorFixer.js
/**
 * 自动修复上游API错误的定时器模块（看门狗）
 * 检测最后一条消息是否包含错误，如果是则自动重试
 */

// 全局变量
let timerId = null;
let currentSelectedItemRef = null;
let currentTopicIdRef = null;
let currentChatHistoryRef = null;
let electronAPI = null;

// 配置
const CONFIG = {
    enabled: true,
    interval: 3000,
    targetAgentId: null,
    targetTopicId: null,
    // 错误检测规则数组 - 纯文本匹配，不使用正则
    errorRules: [
        {
            findText: 'UPSTREAM_ERROR',
            description: '上游API 403错误'
        },
        {
            findText: '可能已达到重试上限或网络错误',
            description: '代理服务器连接失败'
        },
        {
            findText: 'has been suspended',
            description: 'API密钥已暂停'
        },
        {
            findText: 'API key has been suspended',
            description: 'API密钥已暂停'
        }
    ],
    // 重试冷却时间（毫秒）- 防止频繁重试
    retryCooldown: 10000,
    // 最大连续失败次数 - 超过后停止自动重试
    maxConsecutiveFailures: 99999
};

// 防止重复处理的标记集合
let processedMessages = new Set();
let isLoaded = false;
let isRetrying = false; // 是否正在重试中
let lastRetryTime = 0; // 上次重试时间
let consecutiveFailures = 0; // 连续失败次数

// 日志函数
function log(...args) {
    const message = args.join(' ');
    console.log('%c' + message, 'background: #ff0000; color: white; font-size: 14px; padding: 4px;');
    if (window.electronAPI && window.electronAPI.logToMain) {
        window.electronAPI.logToMain('log', '[ERROR-FIXER] ' + message);
    }
}

// 获取看门狗状态指示器元素
function getIndicator() {
    return document.getElementById('errorFixerStatus');
}

/**
 * 设置按钮点击处理函数 - 使用正确的引用
 */
function setupButtonClickHandler() {
    const indicator = getIndicator();
    if (!indicator) {
        log('❌ 找不到看门狗按钮元素');
        return;
    }

    // 移除旧的事件监听器（如果存在）
    indicator.onclick = null;

    // 添加新的点击处理函数
    indicator.onclick = async () => {
        log('🖱️ 看门狗按钮被点击');

        // 使用正确的引用获取聊天历史
        const currentChatHistory = currentChatHistoryRef?.get();
        const currentSelectedItem = currentSelectedItemRef?.get();
        const currentTopicId = currentTopicIdRef?.get();

        if (!currentChatHistory || currentChatHistory.length === 0) {
            log('❌ 没有聊天记录');
            return;
        }

        // 找到最后一条 assistant 消息
        const lastAssistantMessage = [...currentChatHistory].reverse().find(msg => msg.role === 'assistant');

        if (!lastAssistantMessage) {
            log('❌ 没有找到 assistant 消息');
            return;
        }

        // 调用重新回复函数
        if (window.messageContextMenu && window.messageContextMenu.handleRegenerateResponse) {
            try {
                await window.messageContextMenu.handleRegenerateResponse(lastAssistantMessage);
                log('✅ 重新回复已触发');
            } catch (error) {
                log('❌ 重新回复失败: ' + error.message);
            }
        } else {
            log('❌ messageContextMenu.handleRegenerateResponse 不可用');
        }
    };

    log('✅ 按钮点击处理函数已设置');
}

// 更新看门狗按钮状态
function updateIndicator(message, bgColor, pulse = false) {
    const indicator = getIndicator();
    if (indicator) {
        indicator.textContent = message;
        indicator.style.background = bgColor;
        if (pulse) {
            indicator.style.animation = 'pulse 1s infinite';
        } else {
            indicator.style.animation = '';
        }
    }
}

/**
 * 检查最后一条消息是否匹配错误字符串
 */
function checkLastMessage() {
    const currentSelectedItem = currentSelectedItemRef?.get();
    const currentTopicId = currentTopicIdRef?.get();
    const currentChatHistory = currentChatHistoryRef?.get();

    if (!currentSelectedItem || !currentTopicId || !Array.isArray(currentChatHistory) || currentChatHistory.length === 0) {
        return;
    }

    const lastMessage = currentChatHistory[currentChatHistory.length - 1];

    if (!lastMessage || lastMessage.role !== 'assistant') {
        return;
    }

    const messageContent = lastMessage.content || '';
    const messageKey = `${currentSelectedItem.id}-${currentTopicId}-${lastMessage.id}`;

    if (processedMessages.has(messageKey)) {
        return;
    }

    // 检测所有错误规则 - 纯文本匹配，不使用正则
    let matchedRules = [];
    for (const rule of CONFIG.errorRules) {
        if (messageContent.includes(rule.findText)) {
            matchedRules.push(rule);
        }
    }

    if (matchedRules.length > 0) {
        // 检查是否在冷却期内
        const now = Date.now();
        if (isRetrying && (now - lastRetryTime) < CONFIG.retryCooldown) {
            return; // 冷却期内，跳过
        }

        log('🔴 检测到错误: ' + matchedRules.map(r => r.description).join(', '));

        // 增加连续失败计数
        consecutiveFailures++;
        log(`📊 连续失败次数: ${consecutiveFailures}/${CONFIG.maxConsecutiveFailures}`);

        // 检查是否达到最大失败次数
        if (consecutiveFailures >= CONFIG.maxConsecutiveFailures) {
            log('❌ 达到最大连续失败次数，禁用自动重试');
            updateIndicator('🚫 达到最大失败次数 - 自动重试已禁用', 'rgba(255,0,0,0.8)', false);
            return;
        }

        // 更新看门狗按钮提示用户
        updateIndicator(`🐕 检测到错误！自动重试中 (#${consecutiveFailures})`, 'rgba(255,165,0,0.9)', true);

        // 标记为已处理，避免重复处理
        processedMessages.add(messageKey);

        // 设置重试状态
        isRetrying = true;
        lastRetryTime = now;

        // 自动触发重新回复 - 模拟点击看门狗按钮
        const indicator = getIndicator();
        if (indicator) {
            setTimeout(() => {
                log('🔄 自动点击看门狗按钮触发重试');
                indicator.click();
                // 重试完成后，等待一段时间再允许下次重试
                setTimeout(() => {
                    isRetrying = false;
                    log('✅ 重试冷却期结束');
                }, CONFIG.retryCooldown);
            }, 1000);
        }
    } else {
        // 没有错误时，重置连续失败计数
        if (consecutiveFailures > 0) {
            log('✅ 错误已恢复，重置连续失败计数');
            consecutiveFailures = 0;
        }
        // 没有错误时，确保按钮显示正常状态
        updateIndicator('🐕 看门狗运行中', 'rgba(0,128,0,0.8)', false);
    }
}

function start() {
    if (timerId) return;
    timerId = setInterval(checkLastMessage, CONFIG.interval);
    updateIndicator('🐕 看门狗运行中', 'rgba(0,128,0,0.8)', false);
}

function stop() {
    if (timerId) {
        clearInterval(timerId);
        timerId = null;
        updateIndicator('🐕 看门狗已停止', 'rgba(128,128,128,0.8)', false);
    }
}

function updateConfig(newConfig) {
    Object.assign(CONFIG, newConfig);
}

function getConfig() {
    return { ...CONFIG };
}

// 重置看门狗状态（用于手动重新启用自动重试）
function resetState() {
    consecutiveFailures = 0;
    isRetrying = false;
    processedMessages.clear();
    log('✅ 看门狗状态已重置');
    updateIndicator('🐕 看门狗运行中', 'rgba(0,128,0,0.8)', false);
}

function init(config) {
    currentSelectedItemRef = config.currentSelectedItemRef;
    currentTopicIdRef = config.currentTopicIdRef;
    currentChatHistoryRef = config.currentChatHistoryRef;
    electronAPI = config.electronAPI;
    isLoaded = true;
    if (config.config) {
        Object.assign(CONFIG, config.config);
    }
    if (CONFIG.enabled) {
        start();
    }

    // 设置按钮点击处理函数
    setupButtonClickHandler();

    // 添加 CSS 动画
    const style = document.createElement('style');
    style.textContent = `
        @keyframes pulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.1); }
        }
    `;
    document.head.appendChild(style);
}

// 导出
export { init, start, stop, updateConfig, getConfig, setupButtonClickHandler, resetState };

// 挂载到 window
if (typeof window !== 'undefined') {
    window.upstreamErrorFixer = {
        init,
        start,
        stop,
        updateConfig,
        getConfig,
        setupButtonClickHandler,
        resetState,
        isLoaded: () => isLoaded
    };
}
