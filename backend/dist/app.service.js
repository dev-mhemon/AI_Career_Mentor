var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var AppService_1;
import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
let AppService = AppService_1 = class AppService {
    dataSource;
    logger = new Logger(AppService_1.name);
    constructor(dataSource) {
        this.dataSource = dataSource;
    }
    async onApplicationBootstrap() {
        if (this.dataSource.isInitialized) {
            this.logger.log('Database connected successfully');
        }
        else {
            this.logger.error('Database connection failed');
        }
    }
    getHealth() {
        return {
            status: 'ok',
            database: this.dataSource.isInitialized ? 'connected' : 'disconnected',
        };
    }
};
AppService = AppService_1 = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [DataSource])
], AppService);
export { AppService };
//# sourceMappingURL=app.service.js.map