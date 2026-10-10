import {MigrationInterface, QueryRunner} from "typeorm";

export class StorefrontBridge1791632305153 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query("ALTER TABLE `seller` ADD `customFieldsLogoid` int NULL", undefined);
        await queryRunner.query("ALTER TABLE `seller` ADD `customFieldsBannerid` int NULL", undefined);
        await queryRunner.query("ALTER TABLE `seller` ADD `customFieldsSlug` varchar(255) NULL", undefined);
        await queryRunner.query("ALTER TABLE `seller` ADD UNIQUE INDEX `IDX_4ba6ad9672955d7e551e315e74` (`customFieldsSlug`)", undefined);
        await queryRunner.query("ALTER TABLE `seller` ADD `customFieldsDescription` longtext NULL", undefined);
        await queryRunner.query("ALTER TABLE `seller` ADD CONSTRAINT `FK_2d46d0ac63391e9f923f202fca9` FOREIGN KEY (`customFieldsLogoid`) REFERENCES `asset`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION", undefined);
        await queryRunner.query("ALTER TABLE `seller` ADD CONSTRAINT `FK_715fe92a8407043fd59142a5094` FOREIGN KEY (`customFieldsBannerid`) REFERENCES `asset`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION", undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query("ALTER TABLE `seller` DROP FOREIGN KEY `FK_715fe92a8407043fd59142a5094`", undefined);
        await queryRunner.query("ALTER TABLE `seller` DROP FOREIGN KEY `FK_2d46d0ac63391e9f923f202fca9`", undefined);
        await queryRunner.query("ALTER TABLE `seller` DROP COLUMN `customFieldsDescription`", undefined);
        await queryRunner.query("ALTER TABLE `seller` DROP INDEX `IDX_4ba6ad9672955d7e551e315e74`", undefined);
        await queryRunner.query("ALTER TABLE `seller` DROP COLUMN `customFieldsSlug`", undefined);
        await queryRunner.query("ALTER TABLE `seller` DROP COLUMN `customFieldsBannerid`", undefined);
        await queryRunner.query("ALTER TABLE `seller` DROP COLUMN `customFieldsLogoid`", undefined);
   }

}
