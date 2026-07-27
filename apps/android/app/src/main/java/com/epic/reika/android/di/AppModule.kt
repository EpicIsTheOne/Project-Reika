package com.epic.reika.android.di

import android.content.Context
import com.epic.reika.android.data.RelayRepository
import com.epic.reika.android.data.RelaySession
import com.epic.reika.android.data.SessionPreferences
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object AppModule {
    @Provides
    @Singleton
    fun provideRelayRepository(): RelayRepository = RelayRepository()

    @Provides
    @Singleton
    fun provideRelaySession(): RelaySession = RelaySession()

    @Provides
    @Singleton
    fun provideSessionPreferences(@ApplicationContext context: Context): SessionPreferences =
        SessionPreferences(context)
}
