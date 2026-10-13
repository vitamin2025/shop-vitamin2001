import {MigrationInterface, QueryRunner} from "typeorm";

export class SellerPayouts1791874946106 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query("CREATE TABLE `seller_payout` (`createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), `currencyCode` varchar(255) NOT NULL, `paidAt` datetime NOT NULL, `methodName` varchar(255) NOT NULL, `methodDetails` text NOT NULL, `transactionId` varchar(255) NULL, `transactionDetails` text NULL, `recordedBy` varchar(255) NULL, `voidedAt` datetime NULL, `voidReason` text NULL, `id` int NOT NULL AUTO_INCREMENT, `sellerId` int NOT NULL, `payoutMethodId` int NULL, `amount` int NOT NULL, INDEX `IDX_51cf458de55cc40687a364490f` (`sellerId`), PRIMARY KEY (`id`)) ENGINE=InnoDB", undefined);
        await queryRunner.query("CREATE TABLE `payout_method_type` (`createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), `code` varchar(255) NOT NULL, `name` varchar(255) NOT NULL, `description` text NULL, `enabled` tinyint NOT NULL DEFAULT 1, `sortOrder` int NOT NULL DEFAULT '0', `fields` text NOT NULL, `id` int NOT NULL AUTO_INCREMENT, UNIQUE INDEX `IDX_312bc182e84dac39527a64c982` (`code`), PRIMARY KEY (`id`)) ENGINE=InnoDB", undefined);
        await queryRunner.query("CREATE TABLE `seller_payout_method` (`createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), `label` varchar(255) NULL, `details` text NOT NULL, `isDefault` tinyint NOT NULL DEFAULT 0, `deletedAt` datetime NULL, `id` int NOT NULL AUTO_INCREMENT, `sellerId` int NOT NULL, `typeId` int NOT NULL, INDEX `IDX_d19f96bf6b491947d7c5c23a2a` (`sellerId`), PRIMARY KEY (`id`)) ENGINE=InnoDB", undefined);
        await queryRunner.query("ALTER TABLE `seller_payout` ADD CONSTRAINT `FK_51cf458de55cc40687a364490f9` FOREIGN KEY (`sellerId`) REFERENCES `seller`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION", undefined);
        await queryRunner.query("ALTER TABLE `seller_payout_method` ADD CONSTRAINT `FK_d19f96bf6b491947d7c5c23a2a8` FOREIGN KEY (`sellerId`) REFERENCES `seller`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION", undefined);
        await queryRunner.query("ALTER TABLE `seller_payout_method` ADD CONSTRAINT `FK_a9765e2627daa09fb6ecbea1f29` FOREIGN KEY (`typeId`) REFERENCES `payout_method_type`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION", undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query("ALTER TABLE `seller_payout_method` DROP FOREIGN KEY `FK_a9765e2627daa09fb6ecbea1f29`", undefined);
        await queryRunner.query("ALTER TABLE `seller_payout_method` DROP FOREIGN KEY `FK_d19f96bf6b491947d7c5c23a2a8`", undefined);
        await queryRunner.query("ALTER TABLE `seller_payout` DROP FOREIGN KEY `FK_51cf458de55cc40687a364490f9`", undefined);
        await queryRunner.query("DROP INDEX `IDX_d19f96bf6b491947d7c5c23a2a` ON `seller_payout_method`", undefined);
        await queryRunner.query("DROP TABLE `seller_payout_method`", undefined);
        await queryRunner.query("DROP INDEX `IDX_312bc182e84dac39527a64c982` ON `payout_method_type`", undefined);
        await queryRunner.query("DROP TABLE `payout_method_type`", undefined);
        await queryRunner.query("DROP INDEX `IDX_51cf458de55cc40687a364490f` ON `seller_payout`", undefined);
        await queryRunner.query("DROP TABLE `seller_payout`", undefined);
   }

}
