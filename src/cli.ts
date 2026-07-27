#!/usr/bin/env node
import { Command } from 'commander';
import { getVersion } from '#src/lib/utils';

const program = new Command();

program
  .name('grimoire')
  .description('Authoring and distribution for agent skills')
  .version(getVersion());

program.parse();
