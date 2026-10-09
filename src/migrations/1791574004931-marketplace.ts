import {MigrationInterface, QueryRunner} from "typeorm";

export class Marketplace1791574004931 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query("ALTER TABLE `order` ADD `customFieldsCommissionpercent` double NULL", undefined);
        await queryRunner.query("ALTER TABLE `order` ADD `customFieldsCommissionamount` int NULL", undefined);
        await queryRunner.query("ALTER TABLE `order` ADD `customFieldsSellerpayoutamount` int NULL", undefined);
        await queryRunner.query("ALTER TABLE `order` ADD `customFieldsSellerpayoutstatus` varchar(255) NULL", undefined);
        await queryRunner.query("ALTER TABLE `seller` ADD `customFieldsStatus` varchar(255) NOT NULL DEFAULT 'pending'", undefined);
        await queryRunner.query("ALTER TABLE `seller` ADD `customFieldsCommissionpercent` double NULL", undefined);
        await queryRunner.query("ALTER TABLE `seller` ADD `customFieldsContactfirstname` varchar(255) NULL", undefined);
        await queryRunner.query("ALTER TABLE `seller` ADD `customFieldsContactlastname` varchar(255) NULL", undefined);
        await queryRunner.query("ALTER TABLE `seller` ADD `customFieldsContactemail` varchar(255) NULL", undefined);
        await queryRunner.query("ALTER TABLE `seller` ADD `customFieldsContactphone` varchar(255) NULL", undefined);
        await queryRunner.query("ALTER TABLE `seller` ADD `customFieldsGstin` varchar(255) NULL", undefined);
        await queryRunner.query("ALTER TABLE `seller` ADD `customFieldsFssailicencenumber` varchar(255) NULL", undefined);
        await queryRunner.query("ALTER TABLE `seller` ADD `customFieldsAdministratorid` varchar(255) NULL", undefined);
        await queryRunner.query("ALTER TABLE `seller` ADD `customFieldsIshouseshop` tinyint NOT NULL DEFAULT 0", undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query("ALTER TABLE `seller` DROP COLUMN `customFieldsIshouseshop`", undefined);
        await queryRunner.query("ALTER TABLE `seller` DROP COLUMN `customFieldsAdministratorid`", undefined);
        await queryRunner.query("ALTER TABLE `seller` DROP COLUMN `customFieldsFssailicencenumber`", undefined);
        await queryRunner.query("ALTER TABLE `seller` DROP COLUMN `customFieldsGstin`", undefined);
        await queryRunner.query("ALTER TABLE `seller` DROP COLUMN `customFieldsContactphone`", undefined);
        await queryRunner.query("ALTER TABLE `seller` DROP COLUMN `customFieldsContactemail`", undefined);
        await queryRunner.query("ALTER TABLE `seller` DROP COLUMN `customFieldsContactlastname`", undefined);
        await queryRunner.query("ALTER TABLE `seller` DROP COLUMN `customFieldsContactfirstname`", undefined);
        await queryRunner.query("ALTER TABLE `seller` DROP COLUMN `customFieldsCommissionpercent`", undefined);
        await queryRunner.query("ALTER TABLE `seller` DROP COLUMN `customFieldsStatus`", undefined);
        await queryRunner.query("ALTER TABLE `order` DROP COLUMN `customFieldsSellerpayoutstatus`", undefined);
        await queryRunner.query("ALTER TABLE `order` DROP COLUMN `customFieldsSellerpayoutamount`", undefined);
        await queryRunner.query("ALTER TABLE `order` DROP COLUMN `customFieldsCommissionamount`", undefined);
        await queryRunner.query("ALTER TABLE `order` DROP COLUMN `customFieldsCommissionpercent`", undefined);
   }

}
