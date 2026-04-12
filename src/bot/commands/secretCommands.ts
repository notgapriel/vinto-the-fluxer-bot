import { ValidationError } from '../../core/errors.ts';
import type { CommandContextLike, CommandHelperBundle } from './helpers/types.ts';

type SecretCommandHelpers = Pick<
  CommandHelperBundle,
  'createCommand'
  | 'ensureGuild'
>;

type RegistryLike = {
  register: (definition: Readonly<{ name: string }>) => void;
};

export function registerSecretCommands(registry: RegistryLike, h: SecretCommandHelpers) {
  const {
    createCommand,
    ensureGuild,
  } = h;

  registry.register(createCommand({
    name: 'popcorn',
    hidden: true,
    description: 'Easter egg.',
    usage: 'popcorn',
    async execute(ctx: CommandContextLike) {
      ensureGuild(ctx);

      const existing = ctx.sessions.get(ctx.guildId);
      if (!existing) {
        throw new ValidationError('No kernels to pop');
      }

      existing.connection.voiceMaxBitrate = 8000;
      existing.connection.loadAudioTrack();

      await ctx.reply.success(':popcorn:');
      return;
    },
  }));
}
