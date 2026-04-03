// 模块化版本的 popup.js - 应用程序入口点
'use strict';

// 导入所有模块
import { CONFIG } from './modules/config.js';
import { StorageManager } from './modules/storage.js';
import { GitHubAPI } from './modules/github-api.js';
import { CIParser } from './modules/ci-parser.js';
import { Renderer } from './modules/renderer.js';
import { ExpertRecommender } from './modules/expert-recommender.js';
import { PRismApp } from './modules/app.js';

// 全局变量声明（用于向后兼容）
window.CONFIG = CONFIG;
window.Storage = StorageManager;
window.GitHubAPI = GitHubAPI;
window.CIParser = CIParser;
window.Renderer = Renderer;
window.ExpertRecommender = ExpertRecommender;
window.App = PRismApp;

// 创建应用实例并初始化
const app = new PRismApp();

document.addEventListener('DOMContentLoaded', () => {
    app.init().catch(err => {
        console.error('App init failed:', err);
        app.renderer.showStatus(`Init error: ${err.message}`, true);
    });
});
